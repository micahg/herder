import { randomUUID } from "node:crypto";
import type {
  CancelOutreachWorkflowInput,
  CancelOutreachWorkflowResult,
  ContactMessageResult,
  GetOutreachWorkflowStatusInput,
  OutreachChildWorkflowStatus,
  OutreachParticipantInput,
  OutreachWorkflowStatusResult,
  StartOutreachWorkflowInput,
  StartOutreachWorkflowResult,
} from "../protocols/types";

type ParentWorkflowStatus = "active" | "completed" | "failed" | "canceled" | "expired";
type ChildWorkflowStatus = "pending" | "sent" | "responded" | "failed" | "canceled";

interface ChildWorkflowRecord {
  childWorkflowId: string;
  participant: OutreachParticipantInput;
  normalizedParticipantId: string;
  status: ChildWorkflowStatus;
  sentAt?: string;
  responseText?: string;
  responseAt?: string;
  error?: string;
}

interface ParentWorkflowRecord {
  workflowId: string;
  topic: string;
  question: string;
  createdAt: string;
  responseDeadlineAt: string;
  status: ParentWorkflowStatus;
  originChannelId?: string;
  originChannelName?: string;
  evaluationMode?: string;
  children: ChildWorkflowRecord[];
  lastUpdatedAt: string;
}

export interface OutreachInboundMessage {
  contactId: string;
  message: string;
  protocol?: string;
  receivedAt?: string;
}

export interface OutreachWorkflowTransportAdapter {
  protocol?: string;
  sendDirectMessage: (input: { contactId: string; message: string }) => Promise<ContactMessageResult>;
  postChannelMessage?: (input: { channelId: string; message: string }) => Promise<void>;
  normalizeContactId?: (contactId: string) => string;
}

export interface OutreachWorkflowManager {
  startOutreachWorkflow: (input?: StartOutreachWorkflowInput) => Promise<StartOutreachWorkflowResult>;
  getOutreachWorkflowStatus: (
    input?: GetOutreachWorkflowStatusInput
  ) => Promise<OutreachWorkflowStatusResult>;
  cancelOutreachWorkflow: (
    input?: CancelOutreachWorkflowInput
  ) => Promise<CancelOutreachWorkflowResult>;
  handleInboundDirectMessage: (
    input: OutreachInboundMessage
  ) => Promise<OutreachWorkflowStatusResult | null>;
}

const DEFAULT_RESPONSE_WINDOW_HOURS = 24;
const MIN_RESPONSE_WINDOW_HOURS = 1;
const MAX_RESPONSE_WINDOW_HOURS = 24 * 14;

export function createInMemoryOutreachWorkflowManager(
  adapter: OutreachWorkflowTransportAdapter
): OutreachWorkflowManager {
  const workflows = new Map<string, ParentWorkflowRecord>();
  let latestWorkflowId = "";

  const normalizeContactId = (contactId: string): string => {
    const normalized = adapter.normalizeContactId?.(contactId) || contactId;
    return normalized.trim().toLowerCase();
  };

  const toParticipantStatus = (child: ChildWorkflowRecord): OutreachChildWorkflowStatus => ({
    childWorkflowId: child.childWorkflowId,
    participant: child.participant,
    status: child.status,
    ...(child.sentAt ? { sentAt: child.sentAt } : {}),
    ...(child.responseText ? { responseText: child.responseText } : {}),
    ...(child.responseAt ? { responseAt: child.responseAt } : {}),
    ...(child.error ? { error: child.error } : {}),
  });

  const buildSummary = (workflow: ParentWorkflowRecord): string => {
    const respondedCount = workflow.children.filter((child) => child.status === "responded").length;
    const pendingCount = workflow.children.filter(
      (child) => child.status === "pending" || child.status === "sent"
    ).length;
    const failedCount = workflow.children.filter((child) => child.status === "failed").length;

    return [
      `Workflow ${workflow.workflowId} is ${workflow.status}.`,
      `Topic: ${workflow.topic}.`,
      `Responses: ${respondedCount}/${workflow.children.length}.`,
      `Pending: ${pendingCount}.`,
      `Failed: ${failedCount}.`,
      `Deadline: ${workflow.responseDeadlineAt}.`,
    ].join(" ");
  };

  const maybeMarkExpired = (workflow: ParentWorkflowRecord): void => {
    if (workflow.status !== "active") {
      return;
    }

    const now = Date.now();
    const deadline = Date.parse(workflow.responseDeadlineAt);
    if (Number.isFinite(deadline) && now > deadline) {
      workflow.status = "expired";
      workflow.lastUpdatedAt = new Date(now).toISOString();
    }
  };

  const updateParentStatus = (workflow: ParentWorkflowRecord): void => {
    maybeMarkExpired(workflow);

    if (workflow.status === "canceled" || workflow.status === "expired") {
      return;
    }

    const activeChildren = workflow.children.filter(
      (child) => child.status === "pending" || child.status === "sent"
    );
    const respondedChildren = workflow.children.filter((child) => child.status === "responded");
    const failedChildren = workflow.children.filter((child) => child.status === "failed");

    if (respondedChildren.length === 0 && failedChildren.length === workflow.children.length) {
      workflow.status = "failed";
      workflow.lastUpdatedAt = new Date().toISOString();
      return;
    }

    if (activeChildren.length === 0 && respondedChildren.length > 0) {
      workflow.status = "completed";
      workflow.lastUpdatedAt = new Date().toISOString();
      return;
    }

    workflow.status = "active";
  };

  const toStatusResult = (workflow: ParentWorkflowRecord): OutreachWorkflowStatusResult => {
    updateParentStatus(workflow);

    const respondedCount = workflow.children.filter((child) => child.status === "responded").length;
    const pendingCount = workflow.children.filter(
      (child) => child.status === "pending" || child.status === "sent"
    ).length;
    const failedCount = workflow.children.filter((child) => child.status === "failed").length;

    return {
      ok: true,
      workflowId: workflow.workflowId,
      status: workflow.status,
      topic: workflow.topic,
      question: workflow.question,
      createdAt: workflow.createdAt,
      responseDeadlineAt: workflow.responseDeadlineAt,
      participantCount: workflow.children.length,
      respondedCount,
      pendingCount,
      failedCount,
      participants: workflow.children.map(toParticipantStatus),
      summary: buildSummary(workflow),
    };
  };

  const postChannelUpdate = async (workflow: ParentWorkflowRecord, message: string): Promise<void> => {
    if (!adapter.postChannelMessage || !workflow.originChannelId) {
      return;
    }

    try {
      await adapter.postChannelMessage({
        channelId: workflow.originChannelId,
        message,
      });
    } catch {
      // Keep workflow state independent from optional status updates.
    }
  };

  const findWorkflowById = (workflowId?: string): ParentWorkflowRecord | null => {
    const targetWorkflowId = workflowId || latestWorkflowId;
    if (!targetWorkflowId) {
      return null;
    }

    return workflows.get(targetWorkflowId) || null;
  };

  return {
    async startOutreachWorkflow(input: StartOutreachWorkflowInput = {}): Promise<StartOutreachWorkflowResult> {
      const topic = input.topic?.trim() || "General outreach";
      const question =
        input.question?.trim() || `Can you share your response for: ${topic}?`;

      const participants = Array.isArray(input.participants)
        ? input.participants
            .filter((participant) => participant && typeof participant.id === "string")
            .map((participant) => ({
              protocol: participant.protocol || adapter.protocol || "unknown",
              id: participant.id.trim(),
              ...(participant.name ? { name: participant.name.trim() } : {}),
            }))
            .filter((participant) => participant.id.length > 0)
        : [];

      if (participants.length === 0) {
        const createdAt = new Date().toISOString();
        return {
          ok: false,
          workflowId: "",
          status: "failed",
          topic,
          question,
          createdAt,
          responseDeadlineAt: createdAt,
          participants: [],
          summary: "Outreach workflow failed: at least one participant is required.",
          error: "participants is required",
        };
      }

      const responseWindowHours = sanitizeResponseWindowHours(input.responseWindowHours);
      const createdAtDate = new Date();
      const responseDeadlineAtDate = new Date(
        createdAtDate.getTime() + responseWindowHours * 60 * 60 * 1000
      );
      const workflowId = `wf_${randomUUID()}`;

      const children: ChildWorkflowRecord[] = participants.map((participant) => ({
        childWorkflowId: `wf_child_${randomUUID()}`,
        participant,
        normalizedParticipantId: normalizeContactId(participant.id),
        status: "pending",
      }));

      const workflow: ParentWorkflowRecord = {
        workflowId,
        topic,
        question,
        createdAt: createdAtDate.toISOString(),
        responseDeadlineAt: responseDeadlineAtDate.toISOString(),
        status: "active",
        ...(input.originChannelId ? { originChannelId: input.originChannelId } : {}),
        ...(input.originChannelName ? { originChannelName: input.originChannelName } : {}),
        ...(input.evaluationMode ? { evaluationMode: input.evaluationMode } : {}),
        children,
        lastUpdatedAt: createdAtDate.toISOString(),
      };

      workflows.set(workflow.workflowId, workflow);
      latestWorkflowId = workflow.workflowId;

      for (const child of workflow.children) {
        const participantName = child.participant.name?.trim() || child.participant.id;
        const outreachMessage = [
          `Hello ${participantName},`,
          "I am collecting responses for a group coordination request.",
          `Topic: ${workflow.topic}`,
          `Question: ${workflow.question}`,
          `Please reply by ${workflow.responseDeadlineAt}.`,
          `Workflow ID: ${workflow.workflowId}`,
        ].join("\n");

        const result = await adapter.sendDirectMessage({
          contactId: child.participant.id,
          message: outreachMessage,
        });

        if (result.ok) {
          child.status = "sent";
          child.sentAt = new Date().toISOString();
        } else {
          child.status = "failed";
          child.error = result.error || "Failed to send outreach message";
        }
      }

      updateParentStatus(workflow);
      await postChannelUpdate(workflow, `Started outreach workflow ${workflow.workflowId}. ${buildSummary(workflow)}`);

      return {
        ok: workflow.status !== "failed",
        workflowId: workflow.workflowId,
        status: workflow.status,
        topic: workflow.topic,
        question: workflow.question,
        createdAt: workflow.createdAt,
        responseDeadlineAt: workflow.responseDeadlineAt,
        participants: workflow.children.map(toParticipantStatus),
        summary: buildSummary(workflow),
        ...(workflow.status === "failed" ? { error: "Failed to contact all participants" } : {}),
      };
    },

    async getOutreachWorkflowStatus(
      input: GetOutreachWorkflowStatusInput = {}
    ): Promise<OutreachWorkflowStatusResult> {
      const workflow = findWorkflowById(input.workflowId);
      if (!workflow) {
        return {
          ok: false,
          workflowId: input.workflowId || "",
          status: "failed",
          topic: "",
          question: "",
          createdAt: "",
          responseDeadlineAt: "",
          participantCount: 0,
          respondedCount: 0,
          pendingCount: 0,
          failedCount: 0,
          participants: [],
          summary: "Outreach workflow not found.",
          error: "workflow not found",
        };
      }

      return toStatusResult(workflow);
    },

    async cancelOutreachWorkflow(
      input: CancelOutreachWorkflowInput = {}
    ): Promise<CancelOutreachWorkflowResult> {
      const workflow = findWorkflowById(input.workflowId);
      if (!workflow) {
        const canceledAt = new Date().toISOString();
        return {
          ok: false,
          workflowId: input.workflowId || "",
          status: "failed",
          canceledAt,
          reason: input.reason,
          summary: "Outreach workflow not found.",
          error: "workflow not found",
        };
      }

      updateParentStatus(workflow);

      if (workflow.status === "completed" || workflow.status === "failed" || workflow.status === "expired") {
        return {
          ok: false,
          workflowId: workflow.workflowId,
          status: workflow.status,
          canceledAt: new Date().toISOString(),
          reason: input.reason,
          summary: `Outreach workflow is already ${workflow.status}.`,
          error: `workflow already ${workflow.status}`,
        };
      }

      workflow.status = "canceled";
      workflow.lastUpdatedAt = new Date().toISOString();
      for (const child of workflow.children) {
        if (child.status === "pending" || child.status === "sent") {
          child.status = "canceled";
        }
      }

      const canceledAt = new Date().toISOString();
      await postChannelUpdate(
        workflow,
        `Canceled outreach workflow ${workflow.workflowId}.${input.reason ? ` Reason: ${input.reason}` : ""}`
      );

      return {
        ok: true,
        workflowId: workflow.workflowId,
        status: "canceled",
        canceledAt,
        reason: input.reason,
        summary: `Outreach workflow ${workflow.workflowId} was canceled.`,
      };
    },

    async handleInboundDirectMessage(
      input: OutreachInboundMessage
    ): Promise<OutreachWorkflowStatusResult | null> {
      const incomingMessage = input.message.trim();
      if (!incomingMessage) {
        return null;
      }

      const normalizedContactId = normalizeContactId(input.contactId);
      if (!normalizedContactId) {
        return null;
      }

      const activeCandidates = Array.from(workflows.values())
        .filter((workflow) => {
          updateParentStatus(workflow);
          return workflow.status === "active";
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      for (const workflow of activeCandidates) {
        const child = workflow.children.find(
          (candidate) =>
            candidate.normalizedParticipantId === normalizedContactId &&
            (candidate.status === "pending" || candidate.status === "sent")
        );

        if (!child) {
          continue;
        }

        child.status = "responded";
        child.responseText = incomingMessage;
        child.responseAt = input.receivedAt || new Date().toISOString();
        workflow.lastUpdatedAt = new Date().toISOString();
        updateParentStatus(workflow);

        const statusResult = toStatusResult(workflow);
        await postChannelUpdate(
          workflow,
          `Received response from ${child.participant.name || child.participant.id} for workflow ${workflow.workflowId}. ${statusResult.summary}`
        );

        if (workflow.status === "completed") {
          await postChannelUpdate(
            workflow,
            `Workflow ${workflow.workflowId} completed. ${statusResult.summary}`
          );
        }

        return statusResult;
      }

      return null;
    },
  };
}

function sanitizeResponseWindowHours(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RESPONSE_WINDOW_HOURS;
  }

  const rounded = Math.floor(value);
  if (rounded < MIN_RESPONSE_WINDOW_HOURS) {
    return MIN_RESPONSE_WINDOW_HOURS;
  }

  if (rounded > MAX_RESPONSE_WINDOW_HOURS) {
    return MAX_RESPONSE_WINDOW_HOURS;
  }

  return rounded;
}
