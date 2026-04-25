import { describe, expect, it, vi } from "vitest";
import { createInMemoryOutreachWorkflowManager } from "./manager";

describe("createInMemoryOutreachWorkflowManager", () => {
  it("starts workflow, sends messages, and reports status", async () => {
    const sendDirectMessage = vi.fn(async () => ({
      ok: true,
      contactId: "",
      message: "",
      resolvedContactId: "",
    }));

    const manager = createInMemoryOutreachWorkflowManager({
      protocol: "whatsapp",
      sendDirectMessage,
      normalizeContactId: (id) => id.split("@", 1)[0] || id,
    });

    const startResult = await manager.startOutreachWorkflow({
      topic: "Schedule DnD session",
      question: "What times work between Monday and Friday?",
      participants: [
        { protocol: "whatsapp", id: "111@c.us", name: "Alice" },
        { protocol: "whatsapp", id: "222@c.us", name: "Bob" },
      ],
      responseWindowHours: 72,
    });

    expect(startResult.ok).toBe(true);
    expect(startResult.workflowId).toContain("wf_");
    expect(startResult.participants).toHaveLength(2);
    expect(sendDirectMessage).toHaveBeenCalledTimes(2);

    const statusResult = await manager.getOutreachWorkflowStatus({
      workflowId: startResult.workflowId,
    });

    expect(statusResult.ok).toBe(true);
    expect(statusResult.participantCount).toBe(2);
    expect(statusResult.pendingCount).toBe(2);
    expect(statusResult.respondedCount).toBe(0);
  });

  it("captures inbound replies and updates workflow counts", async () => {
    const manager = createInMemoryOutreachWorkflowManager({
      protocol: "whatsapp",
      sendDirectMessage: async (input) => ({
        ok: true,
        contactId: input.contactId,
        resolvedContactId: input.contactId,
        message: input.message,
      }),
      normalizeContactId: (id) => id.split("@", 1)[0] || id,
    });

    const startResult = await manager.startOutreachWorkflow({
      topic: "Weekly planning",
      question: "Share your availability",
      participants: [{ protocol: "whatsapp", id: "111@c.us", name: "Alice" }],
      responseWindowHours: 24,
    });

    const update = await manager.handleInboundDirectMessage({
      contactId: "111@lid",
      message: "I am free Tuesday after 6pm",
      protocol: "whatsapp",
    });

    expect(update).not.toBeNull();
    expect(update?.workflowId).toBe(startResult.workflowId);
    expect(update?.respondedCount).toBe(1);
    expect(update?.pendingCount).toBe(0);
    expect(update?.status).toBe("completed");
    expect(update?.participants[0]?.responseText).toContain("Tuesday");
  });

  it("cancels active workflows", async () => {
    const manager = createInMemoryOutreachWorkflowManager({
      protocol: "whatsapp",
      sendDirectMessage: async (input) => ({
        ok: true,
        contactId: input.contactId,
        resolvedContactId: input.contactId,
        message: input.message,
      }),
    });

    const startResult = await manager.startOutreachWorkflow({
      topic: "Survey",
      question: "How do you feel about proposal A?",
      participants: [{ protocol: "whatsapp", id: "333@c.us", name: "Chris" }],
      responseWindowHours: 48,
    });

    const cancelResult = await manager.cancelOutreachWorkflow({
      workflowId: startResult.workflowId,
      reason: "No longer needed",
    });

    expect(cancelResult.ok).toBe(true);
    expect(cancelResult.status).toBe("canceled");

    const status = await manager.getOutreachWorkflowStatus({
      workflowId: startResult.workflowId,
    });

    expect(status.status).toBe("canceled");
  });
});
