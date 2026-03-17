import { describe, expect, it } from "vitest";
import { parseFirstIncomingMessage } from "./whatsapp-webhook";

describe("parseFirstIncomingMessage", () => {
  it("returns parsed fields for text messages", () => {
    const parsed = parseFirstIncomingMessage({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "pnid-123" },
                messages: [
                  {
                    id: "msg-123",
                    from: "15551230000",
                    type: "text",
                    text: { body: "  hello there  " },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed).toEqual({
      phoneNumberId: "pnid-123",
      from: "15551230000",
      messageId: "msg-123",
      type: "text",
      textBody: "hello there",
    });
  });

  it("returns parsed non-text message without textBody", () => {
    const parsed = parseFirstIncomingMessage({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "pnid-123" },
                messages: [
                  {
                    id: "msg-456",
                    from: "15551230000",
                    type: "image",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed).toEqual({
      phoneNumberId: "pnid-123",
      from: "15551230000",
      messageId: "msg-456",
      type: "image",
      textBody: undefined,
    });
  });

  it("skips non-message changes and finds first actionable message", () => {
    const parsed = parseFirstIncomingMessage({
      entry: [
        {
          changes: [
            {
              field: "statuses",
              value: {},
            },
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "pnid-456" },
                messages: [
                  {
                    id: "msg-789",
                    from: "15559870000",
                    type: "text",
                    text: { body: "yo" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed?.messageId).toBe("msg-789");
    expect(parsed?.phoneNumberId).toBe("pnid-456");
  });

  it("returns null when payload is malformed", () => {
    expect(parseFirstIncomingMessage(null)).toBeNull();
    expect(parseFirstIncomingMessage({})).toBeNull();
    expect(
      parseFirstIncomingMessage({
        entry: [{ changes: [{ field: "messages", value: { metadata: {} } }] }],
      })
    ).toBeNull();
  });
});
