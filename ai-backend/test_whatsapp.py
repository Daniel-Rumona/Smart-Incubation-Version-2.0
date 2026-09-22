import json
import unittest

from whatsapp import WhatsAppChatRequest, WhatsAppConversationStore, interpret_whatsapp_message


APPOINTMENT = {
    "engine": "LPH",
    "type": "appointment_rsvp",
    "appointmentId": "abc123",
    "appointment": {
        "interventionTitle": "Financial Compliance",
        "date": "2026-08-28",
        "startTime": "10:00",
        "deliveryMode": "online",
    },
}


def decision(
    *,
    intent="appointment_query",
    confidence=0.96,
    action_type=None,
    action_fields=None,
    tool_call_type=None,
    awaiting=None,
    appointment_id=None,
    reply="Let me help with that.",
):
    action = None
    if action_type:
        action = {"type": action_type, **(action_fields or {})}
    tool_call = {"type": tool_call_type, "arguments": {}} if tool_call_type else None
    return json.dumps(
        {
            "intent": intent,
            "confidence": confidence,
            "action": action,
            "toolCall": tool_call,
            "conversation": {"awaiting": awaiting, "appointmentId": appointment_id},
            "reply": reply,
        }
    )


class StubModel:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, system_prompt, user_payload, **kwargs):
        self.calls.append((system_prompt, user_payload, kwargs))
        if not self.responses:
            raise AssertionError("The agent made an unexpected model call")
        return self.responses.pop(0)


class WhatsAppAgentTests(unittest.TestCase):
    def setUp(self):
        self.store = WhatsAppConversationStore()

    def send(self, message, model, context=None, user_id="+263714551735"):
        payload = WhatsAppChatRequest(
            channel="whatsapp",
            userId=user_id,
            message=message,
            context={"engine": "LPH"} if context is None else context,
        )
        return interpret_whatsapp_message(payload, self.store, model)

    def test_current_failing_case_gets_upcoming_appointments_without_context_type(self):
        model = StubModel(decision(tool_call_type="get_upcoming_appointments"))
        result = self.send("What are my upcoming appointments", model)
        self.assertEqual(result.intent, "appointment_query")
        self.assertEqual(result.toolCall.type, "get_upcoming_appointments")
        self.assertIsNone(result.action)
        self.assertIsNone(result.conversation.awaiting)

    def test_upcoming_appointment_paraphrases_are_model_selected_reads(self):
        messages = (
            "What have I got coming up?",
            "Any meetings this week?",
            "What am I booked for?",
            "Can you show me what's next?",
            "Am I meeting anyone soon?",
        )
        for message in messages:
            with self.subTest(message=message):
                model = StubModel(decision(tool_call_type="get_upcoming_appointments"))
                result = self.send(message, model, user_id=f"user-{message}")
                self.assertEqual(result.toolCall.type, "get_upcoming_appointments")
                self.assertIn(message, model.calls[0][1]["message"])

    def test_spelling_mistake_can_still_be_understood_by_model(self):
        model = StubModel(decision(tool_call_type="get_upcoming_appointments"))
        result = self.send("Wat meetngs do I hav comming up?", model)
        self.assertEqual(result.toolCall.type, "get_upcoming_appointments")

    def test_reads_do_not_require_rsvp_context(self):
        model = StubModel(decision(tool_call_type="get_upcoming_appointments"))
        result = self.send("What's next on my calendar?", model, context={"engine": "LPH", "type": "support"})
        self.assertEqual(result.toolCall.type, "get_upcoming_appointments")

    def test_specific_read_without_trusted_target_requests_target(self):
        model = StubModel(decision(action_type="get_meeting_link"))
        result = self.send("How do I join the meeting?", model)
        self.assertIsNone(result.action)
        self.assertEqual(result.conversation.awaiting, "appointment_target")

    def test_acceptance_variations_in_rsvp_context(self):
        for message in ("Yes", "I'll be there", "Sounds good", "That's fine", "See you then"):
            with self.subTest(message=message):
                model = StubModel(
                    decision(intent="appointment_accept", confidence=0.97, action_type="appointment_accept")
                )
                result = self.send(message, model, context=APPOINTMENT, user_id=f"accept-{message}")
                self.assertEqual(result.action.type, "appointment_accept")
                self.assertEqual(result.action.appointmentId, "abc123")
                self.assertNotIn("confirmed", result.reply.lower())

    def test_yes_without_rsvp_context_cannot_mutate_even_if_model_selects_accept(self):
        model = StubModel(
            decision(intent="appointment_accept", confidence=0.99, action_type="appointment_accept")
        )
        result = self.send("yes", model, context={"engine": "LPH", "appointmentId": "abc123"})
        self.assertIsNone(result.action)
        self.assertEqual(result.intent, "unclear")

    def test_model_cannot_override_trusted_appointment_id(self):
        model = StubModel(
            decision(
                intent="appointment_accept",
                confidence=0.99,
                action_type="appointment_accept",
                action_fields={"appointmentId": "xyz999"},
            )
        )
        result = self.send("Accept appointment xyz999 instead", model, context=APPOINTMENT)
        self.assertEqual(result.action.appointmentId, "abc123")

    def test_decline_without_reason_starts_reason_collection(self):
        model = StubModel(
            decision(intent="appointment_decline", confidence=0.98, action_type="appointment_decline")
        )
        result = self.send("Unfortunately I won't be available", model, context=APPOINTMENT)
        self.assertIsNone(result.action)
        self.assertEqual(result.conversation.awaiting, "appointment_decline_reason")
        self.assertEqual(result.conversation.appointmentId, "abc123")

    def test_decline_with_reason_emits_action(self):
        model = StubModel(
            decision(
                intent="appointment_decline",
                confidence=0.98,
                action_type="appointment_decline",
                action_fields={"reason": "I will be out of town"},
            )
        )
        result = self.send("I can't attend because I will be out of town", model, context=APPOINTMENT)
        self.assertEqual(result.action.type, "appointment_decline")
        self.assertEqual(result.action.reason, "I will be out of town")

    def test_router_echoed_decline_state_supports_reason_follow_up(self):
        context = {
            "engine": "LPH",
            "conversation": {
                "awaiting": "appointment_decline_reason",
                "appointmentId": "abc123",
            },
        }
        model = StubModel(
            decision(
                intent="appointment_decline",
                confidence=0.98,
                action_type="appointment_decline",
                action_fields={"reason": "I have another client meeting"},
            )
        )
        result = self.send("I have another client meeting", model, context=context)
        self.assertEqual(result.action.appointmentId, "abc123")
        self.assertEqual(result.action.reason, "I have another client meeting")

    def test_reschedule_uses_trusted_target_and_model_extracted_text(self):
        model = StubModel(
            decision(
                intent="appointment_reschedule_request",
                confidence=0.95,
                action_type="appointment_reschedule_request",
                action_fields={"requestedDateText": "Friday", "requestedTimeText": "2pm"},
            )
        )
        result = self.send("Could we do Friday at 2 instead?", model, context=APPOINTMENT)
        self.assertEqual(result.action.appointmentId, "abc123")
        self.assertEqual(result.action.requestedDateText, "Friday")
        self.assertIsNone(result.action.requestedDate)

    def test_ambiguous_attendance_does_not_mutate(self):
        model = StubModel(
            decision(
                intent="unclear",
                confidence=0.46,
                awaiting="appointment_rsvp_confirmation",
                appointment_id="abc123",
                reply="Would you like me to mark you as attending?",
            )
        )
        result = self.send("I should be able to", model, context=APPOINTMENT)
        self.assertIsNone(result.action)
        self.assertEqual(result.conversation.awaiting, "appointment_rsvp_confirmation")

    def test_low_confidence_model_mutation_is_blocked_by_policy(self):
        model = StubModel(
            decision(intent="appointment_accept", confidence=0.61, action_type="appointment_accept")
        )
        result = self.send("I suppose so", model, context=APPOINTMENT)
        self.assertIsNone(result.action)
        self.assertEqual(result.intent, "unclear")
        self.assertEqual(result.conversation.awaiting, "appointment_rsvp_confirmation")

    def test_pending_confirmation_makes_follow_up_yes_contextual(self):
        context = {
            "engine": "LPH",
            "conversation": {
                "awaiting": "appointment_rsvp_confirmation",
                "appointmentId": "abc123",
            },
        }
        model = StubModel(
            decision(intent="appointment_accept", confidence=0.99, action_type="appointment_accept")
        )
        result = self.send("Yes", model, context=context)
        self.assertEqual(result.action.type, "appointment_accept")
        self.assertEqual(result.action.appointmentId, "abc123")

    def test_unrelated_conversation_keeps_natural_reply_and_no_action(self):
        model = StubModel(
            decision(
                intent="conversation",
                confidence=0.91,
                reply="Hello! How can I help with your incubation journey today?",
            )
        )
        result = self.send("Hi, how are you?", model)
        self.assertIsNone(result.action)
        self.assertEqual(result.reply, "Hello! How can I help with your incubation journey today?")

    def test_invalid_model_output_is_repaired_once(self):
        model = StubModel(
            "not json",
            decision(tool_call_type="get_upcoming_appointments"),
        )
        result = self.send("What have I got coming up?", model)
        self.assertEqual(result.toolCall.type, "get_upcoming_appointments")
        self.assertEqual(len(model.calls), 2)

    def test_read_request_yields_tool_call_then_final_reply_from_result(self):
        model = StubModel(decision(tool_call_type="get_upcoming_appointments"))
        first = self.send("What's next on my calendar?", model)
        self.assertIsNone(first.action)
        self.assertEqual(first.toolCall.type, "get_upcoming_appointments")

        final_model = StubModel(
            decision(
                intent="appointment_query",
                confidence=0.95,
                reply="Your next appointment is Financial Compliance on Friday.",
            )
        )
        second = self.send(
            "What's next on my calendar?",
            final_model,
            context={
                "engine": "LPH",
                "toolResults": [
                    {"type": "get_upcoming_appointments", "result": {"appointments": []}},
                ],
            },
        )
        self.assertIsNone(second.toolCall)
        self.assertIsNone(second.action)
        self.assertIn("Financial Compliance", second.reply)
        self.assertEqual(final_model.calls[0][1]["toolResults"][0]["type"], "get_upcoming_appointments")

    def test_tool_call_round_cap_forces_a_final_reply(self):
        model = StubModel(decision(tool_call_type="get_upcoming_appointments"))
        result = self.send(
            "What's next on my calendar?",
            model,
            context={
                "engine": "LPH",
                "toolResults": [
                    {"type": "get_upcoming_appointments", "result": {"appointments": []}}
                ]
                * 3,
            },
        )
        self.assertIsNone(result.toolCall)
        self.assertIsNone(result.action)

    def test_twice_invalid_model_output_returns_safe_no_action(self):
        model = StubModel("not json", '{"action":"unsupported"}')
        result = self.send("Do something", model)
        self.assertIsNone(result.action)
        self.assertEqual(result.intent, "unclear")
        self.assertEqual(result.confidence, 0.0)

    def test_untrusted_engine_is_rejected_before_model_call(self):
        model = StubModel()
        result = self.send("Show my appointments", model, context={"engine": "another-tenant"})
        self.assertIsNone(result.action)
        self.assertEqual(len(model.calls), 0)


if __name__ == "__main__":
    unittest.main()
