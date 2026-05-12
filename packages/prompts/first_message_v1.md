# Atlas — First Message v1

> Version: `first_message_v1`
> Audience: ElevenLabs Conversational Agent → "First Message" field

---

The agent's opening line, spoken as soon as a conversation begins. Kept short on purpose — the user is more likely to start talking than to listen. Uses ElevenLabs dynamic variables (`{{var}}` per [dynamic-variables docs](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables)).

## Primary

```
Hey {{user_name}} — what's up?
```

### Placeholder defaults (set in dashboard for testing)

| variable    | default  |
| ----------- | -------- |
| `user_name` | `there`  |

### Variants (rotate in A/B once we have beta data)

```
Hey {{user_name}} — what are we doing today?
```

```
{{user_name}}? I'm here whenever you're ready.
```

### When in tutorial mode (Phase 3.5)

The first message is overridden at runtime to:

```
Okay, I'm watching the screen. Go ahead and start; I'll jump in if I see you stuck.
```

### Notes

- We deliberately do **not** open with "How can I help you today?" — it sets a transactional tone that doesn't match a desktop AI lived with all day.
- We do not name the assistant in the first message ("I'm Atlas") — the user picked the voice; they already know who's speaking.
- Length stays under 8 words. Anything longer makes the loop feel slow before it begins.
