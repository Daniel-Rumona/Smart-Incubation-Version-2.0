"""Turns a questionnaire document into survey builder fields.

Operations teams usually already have the questionnaire as a Word file, PDF or
pasted text. This reads one, and returns the questions in the same shape the
survey builder stores them, so importing is a review step rather than retyping.
"""

from __future__ import annotations

import base64
import html
import io
import json
import re
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
MAX_TEXT_CHARS = 60_000
MAX_FIELDS = 80

# Kept in step with SURVEY_FIELD_TYPES in src/services/surveyTemplatesService.ts.
FIELD_TYPES = {
    "text",
    "textarea",
    "number",
    "email",
    "select",
    "checkbox",
    "radio",
    "date",
    "file",
    "rating",
    "heading",
}

OPTION_TYPES = {"select", "checkbox", "radio"}

SYSTEM_PROMPT = """You convert questionnaires into structured survey definitions.

Return JSON only, matching this shape:
{
  "title": "string, the questionnaire's own title if it has one, else empty",
  "description": "one sentence describing the questionnaire, else empty",
  "category": "Evaluation Form" | "Feedback Form" | "Assessment" | "Gap Analysis" | "",
  "fields": [
    {
      "type": "text|textarea|number|email|select|checkbox|radio|date|file|rating|heading",
      "label": "the question exactly as asked, without its number",
      "placeholder": "optional hint",
      "description": "optional guidance that accompanied the question",
      "required": true|false,
      "options": ["only for select, checkbox and radio"]
    }
  ]
}

Rules:
- Keep the document's order, and keep every question. Do not invent questions.
- A line that titles a group of questions becomes a "heading" field.
- Answer choices listed under a question become its options; pick radio for a
  single choice, checkbox where several may apply, select where there are many.
- Use "number" for quantities, "date" for dates, "email" for email addresses,
  "file" where a document must be attached, "rating" for 1-5 style scales.
- Use "textarea" where a long written answer is expected, "text" otherwise.
- Mark required only where the document says so (an asterisk, "required", or
  "compulsory"). Otherwise false.
- The document may be a completed form or report. Take only the questions and
  field labels; never turn the answers given into questions or options.
- Tables whose first column lists items to assess (e.g. "Revenue / turnover",
  "Cash flow") become one question per row, under the table's section heading.
- A per-section score such as "Diagnostic rating 2 / 5" becomes a "rating"
  question labelled "<section> rating" at the end of that section.
- When preferredCategory is "Gap Analysis", group every question under a
  "heading" for the business area it assesses, and skip signature blocks.
- Never include commentary outside the JSON.
"""

_NUMBER_PREFIX = re.compile(r"^\s*(?:\d+[.)]|[a-z][.)]|[-*•])\s+", re.IGNORECASE)


class SurveyImportRequest(BaseModel):
    """Either raw text, or a base64 document with its filename."""

    text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    fileName: str | None = None
    fileBase64: str | None = None
    category: str | None = None


class ImportedField(BaseModel):
    type: str
    label: str
    placeholder: str | None = None
    description: str | None = None
    required: bool = False
    options: list[str] | None = None


class SurveyImportResponse(BaseModel):
    ok: bool = True
    title: str = ""
    description: str = ""
    category: str = ""
    fields: list[ImportedField] = Field(default_factory=list)
    source: str = "text"
    warnings: list[str] = Field(default_factory=list)


def _decode_document(file_name: str, encoded: str) -> str:
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as error:  # noqa: BLE001 - surfaced to the caller verbatim
        raise HTTPException(status_code=400, detail="The document could not be decoded") from error

    if len(raw) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="The document is larger than 8MB")

    name = (file_name or "").lower()

    if name.endswith(".docx"):
        try:
            from docx import Document  # imported lazily: only this route needs it
        except ImportError as error:
            raise HTTPException(status_code=500, detail="Word support is not installed on the server") from error

        document = Document(io.BytesIO(raw))
        blocks = [paragraph.text for paragraph in document.paragraphs]
        for table in document.tables:
            for row in table.rows:
                blocks.append(" | ".join(cell.text.strip() for cell in row.cells))
        return "\n".join(block for block in blocks if block.strip())

    if name.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError as error:
            raise HTTPException(status_code=500, detail="PDF support is not installed on the server") from error

        reader = PdfReader(io.BytesIO(raw))
        return "\n".join((page.extract_text() or "") for page in reader.pages)

    if name.endswith((".txt", ".md", ".csv")):
        return raw.decode("utf-8", errors="ignore")

    if name.endswith((".html", ".htm")):
        return _html_to_text(raw.decode("utf-8", errors="ignore"))

    raise HTTPException(status_code=415, detail="Upload a .docx, .pdf, .html, .txt, .md or .csv file")


_BLOCK_TAGS = re.compile(r"</?(?:p|div|br|tr|h[1-6]|li|table|section|b|th)\b[^>]*>", re.IGNORECASE)
_CELL_TAGS = re.compile(r"</t[dh]>", re.IGNORECASE)


def _html_to_text(markup: str) -> str:
    """Saved reports and web forms: keep one line per block and " | " between table cells."""
    markup = re.sub(r"<(script|style|head)\b[^>]*>.*?</\1>", " ", markup, flags=re.IGNORECASE | re.DOTALL)
    markup = re.sub(r"<img\b[^>]*>", " ", markup, flags=re.IGNORECASE)
    markup = _CELL_TAGS.sub(" | ", markup)
    markup = _BLOCK_TAGS.sub("\n", markup)
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup))
    lines = (re.sub(r"[ \t]+", " ", line).strip(" |") for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def _clean_label(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return _NUMBER_PREFIX.sub("", text).strip()


def _normalise_fields(raw_fields: Any) -> tuple[list[ImportedField], list[str]]:
    warnings: list[str] = []
    fields: list[ImportedField] = []

    if not isinstance(raw_fields, list):
        return fields, ["The document did not produce any questions"]

    for entry in raw_fields:
        if not isinstance(entry, dict):
            continue

        label = _clean_label(entry.get("label"))
        if not label:
            continue

        field_type = str(entry.get("type") or "text").strip().lower()
        if field_type not in FIELD_TYPES:
            warnings.append(f'"{label}" used an unknown type and was imported as text')
            field_type = "text"

        options = entry.get("options")
        cleaned_options = [
            _clean_label(option)
            for option in options
            if _clean_label(option)
        ] if isinstance(options, list) else []

        if field_type in OPTION_TYPES and not cleaned_options:
            # A choice question with no choices is unusable; a text field at least
            # keeps the question.
            warnings.append(f'"{label}" had no answer options and was imported as text')
            field_type = "text"

        fields.append(
            ImportedField(
                type=field_type,
                label=label[:300],
                placeholder=(_clean_label(entry.get("placeholder")) or None),
                description=(_clean_label(entry.get("description")) or None),
                required=bool(entry.get("required")),
                options=cleaned_options[:20] if field_type in OPTION_TYPES else None,
            )
        )

        if len(fields) >= MAX_FIELDS:
            warnings.append(f"Only the first {MAX_FIELDS} questions were imported")
            break

    return fields, warnings


def _parse_model_json(text: str) -> dict[str, Any]:
    candidate = text.strip()

    if candidate.startswith("```"):
        candidate = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", candidate).strip()

    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        # Models occasionally wrap the object in a sentence; take the outermost braces.
        match = re.search(r"\{.*\}", candidate, re.DOTALL)
        if not match:
            raise HTTPException(status_code=502, detail="The document could not be read as a questionnaire")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=502, detail="The document could not be read as a questionnaire") from error

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="The document could not be read as a questionnaire")

    return parsed


def create_survey_import_router(
    call_model: Callable[..., str],
    require_auth: Callable[[str | None], Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/surveys", tags=["surveys"])

    @router.post("/import-questions", response_model=SurveyImportResponse)
    async def import_questions(
        payload: SurveyImportRequest,
        authorization: str | None = Header(default=None),
    ) -> SurveyImportResponse:
        require_auth(authorization)

        source = "text"
        document_text = (payload.text or "").strip()

        if payload.fileBase64:
            document_text = _decode_document(payload.fileName or "", payload.fileBase64).strip()
            source = "document"

        if not document_text:
            raise HTTPException(status_code=400, detail="Provide a document or paste the questionnaire text")

        if len(document_text) > MAX_TEXT_CHARS:
            document_text = document_text[:MAX_TEXT_CHARS]

        raw = call_model(
            SYSTEM_PROMPT,
            {
                "documentName": payload.fileName or "pasted text",
                "preferredCategory": payload.category or "",
                "document": document_text,
            },
            max_output_tokens=4000,
            response_mime_type="application/json",
        )

        parsed = _parse_model_json(raw)
        fields, warnings = _normalise_fields(parsed.get("fields"))

        if not fields:
            raise HTTPException(status_code=422, detail="No questions were found in that document")

        category = str(parsed.get("category") or payload.category or "").strip()

        return SurveyImportResponse(
            title=_clean_label(parsed.get("title"))[:200],
            description=_clean_label(parsed.get("description"))[:500],
            category=category,
            fields=fields,
            source=source,
            warnings=warnings,
        )

    return router
