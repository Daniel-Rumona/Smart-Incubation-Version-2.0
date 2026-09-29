"""Builds course lessons and quizzes from source material.

Operations teams usually already have the training content as a PDF or Word
file. The browser extracts the text (so the file itself never has to be sent),
and this turns it into lessons in the shape the course builder stores, and
later into quiz questions grounded in a lesson's own text.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

MAX_TEXT_CHARS = 60_000
MAX_LESSONS = 12
MAX_QUESTIONS = 8

LESSON_SYSTEM_PROMPT = (
    "You turn a source document into a short online course for small-business owners. "
    "Split the document into between 3 and 8 lessons that follow the document's own structure and order. "
    "Each lesson has a short clear title (under 80 characters) and a body of plain teaching text: short paragraphs "
    "separated by blank lines, and simple bullet lines starting with '- ' where a list helps. Aim for 120 to 400 words "
    "per lesson. Stay faithful to the document: rewrite for clarity, but do not add facts, figures or claims that are "
    "not in it, and do not mention 'the document' or 'the text'. Also give the course a title and a one or two "
    "sentence description. Reply with ONLY a JSON object, no markdown fences, in exactly this shape: "
    '{"title": "...", "description": "...", "lessons": [{"title": "...", "body": "..."}]}'
)

QUIZ_SYSTEM_PROMPT = (
    "You write quiz questions that check understanding of ONE lesson. Use only what the lesson text says; never "
    "test facts that are not in it. Mix question types: mostly 'single' (one correct option), and use 'multiple' "
    "(two or more correct options) or 'text' (a short written answer, no options) only when it suits the content. "
    "Give 3 to 5 options for choice questions, keep options similar in length, make wrong options plausible, and "
    "vary which position is correct. Reply with ONLY a JSON object, no markdown fences, in exactly this shape: "
    '{"questions": [{"type": "single", "question": "...", "options": ["..."], "correctIndices": [0]}]}. '
    "For a 'text' question use an empty options list and an empty correctIndices list."
)


class LessonRequest(BaseModel):
    text: str = Field(default="", max_length=400_000)
    fileName: str | None = Field(default=None, max_length=300)


class GeneratedLesson(BaseModel):
    title: str
    body: str


class LessonResponse(BaseModel):
    title: str
    description: str
    lessons: list[GeneratedLesson]


class QuizRequest(BaseModel):
    lessonTitle: str = Field(default="", max_length=300)
    lessonBody: str = Field(default="", max_length=60_000)
    count: int = Field(default=3, ge=1, le=MAX_QUESTIONS)


class GeneratedQuestion(BaseModel):
    type: str
    question: str
    options: list[str]
    correctOptions: list[str]


class QuizResponse(BaseModel):
    questions: list[GeneratedQuestion]


def _clean(value: Any, limit: int) -> str:
    return re.sub(r"[ \t]+", " ", str(value or "")).strip()[:limit]


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
            raise HTTPException(status_code=502, detail="The assistant's reply could not be read")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=502, detail="The assistant's reply could not be read") from error

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="The assistant's reply could not be read")

    return parsed


def _normalise_lessons(raw: Any) -> list[GeneratedLesson]:
    lessons: list[GeneratedLesson] = []

    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        title = _clean(item.get("title"), 200)
        body = str(item.get("body") or "").strip()
        if title and body:
            lessons.append(GeneratedLesson(title=title, body=body[:20_000]))

    return lessons[:MAX_LESSONS]


def _normalise_questions(raw: Any, limit: int) -> list[GeneratedQuestion]:
    questions: list[GeneratedQuestion] = []

    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue

        kind = str(item.get("type") or "single").strip().lower()
        if kind not in {"single", "multiple", "text"}:
            kind = "single"
        question = _clean(item.get("question"), 500)
        if not question:
            continue

        if kind == "text":
            questions.append(GeneratedQuestion(type="text", question=question, options=[], correctOptions=[]))
            continue

        options = [_clean(option, 300) for option in item.get("options") or [] if _clean(option, 300)]
        indices = [index for index in item.get("correctIndices") or [] if isinstance(index, int) and 0 <= index < len(options)]

        if len(options) < 2 or not indices:
            continue
        if kind == "single":
            indices = indices[:1]
        elif len(indices) < 2:
            kind = "single"

        questions.append(GeneratedQuestion(
            type=kind,
            question=question,
            options=options,
            correctOptions=[options[index] for index in dict.fromkeys(indices)],
        ))

    return questions[:limit]


def create_course_builder_router(
    call_model: Callable[..., str],
    require_auth: Callable[[str | None], Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/courses", tags=["courses"])

    @router.post("/generate-lessons", response_model=LessonResponse)
    async def generate_lessons(payload: LessonRequest, authorization: str | None = Header(default=None)) -> LessonResponse:
        require_auth(authorization)

        text = payload.text.strip()
        if len(text) < 200:
            raise HTTPException(status_code=400, detail="There is not enough readable text in that file to build lessons from")

        raw = call_model(
            LESSON_SYSTEM_PROMPT,
            {"documentName": payload.fileName or "document", "document": text[:MAX_TEXT_CHARS]},
            max_output_tokens=8000,
            response_mime_type="application/json",
        )

        parsed = _parse_model_json(raw)
        lessons = _normalise_lessons(parsed.get("lessons"))

        if not lessons:
            raise HTTPException(status_code=422, detail="No lessons could be built from that file")

        return LessonResponse(
            title=_clean(parsed.get("title"), 200),
            description=_clean(parsed.get("description"), 500),
            lessons=lessons,
        )

    @router.post("/generate-quiz", response_model=QuizResponse)
    async def generate_quiz(payload: QuizRequest, authorization: str | None = Header(default=None)) -> QuizResponse:
        require_auth(authorization)

        body = payload.lessonBody.strip()
        if len(body) < 100:
            raise HTTPException(status_code=400, detail="The lesson needs some content before a quiz can be written from it")

        raw = call_model(
            QUIZ_SYSTEM_PROMPT,
            {"lessonTitle": payload.lessonTitle, "lesson": body, "questionCount": payload.count},
            max_output_tokens=3000,
            response_mime_type="application/json",
        )

        parsed = _parse_model_json(raw)
        questions = _normalise_questions(parsed.get("questions"), payload.count)

        if not questions:
            raise HTTPException(status_code=422, detail="No usable questions were written for that lesson")

        return QuizResponse(questions=questions)

    return router
