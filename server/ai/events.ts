import type { AiTask } from './types';

/**
 * The gateway's audit port. Every schema rejection, safety block and fallback
 * is parent-visible, so the tutoring loop can degrade quietly for the child
 * while an adult can still see that the model misbehaved.
 *
 * `detail` carries rule identifiers and validation messages only. Model text
 * and child content never go in here — an audit trail must not become a copy of
 * the thing we refused to show.
 */

export type SafetyEventType =
  | 'schema_rejected'
  | 'repair_retry'
  | 'output_rejected'
  | 'safety_block'
  | 'route_denied'
  | 'fallback_served';

export type SafetyEvent = {
  type: SafetyEventType;
  task: AiTask;
  promptVersion: string;
  provider: string;
  model: string;
  reason: string;
  detail?: string;
  sessionId?: string;
  createdAt: number;
};

export interface SafetyEventSink {
  record(event: SafetyEvent): void;
}

export class MemorySafetyEventSink implements SafetyEventSink {
  readonly events: SafetyEvent[] = [];

  record(event: SafetyEvent): void {
    this.events.push(event);
  }

  ofType(type: SafetyEventType): SafetyEvent[] {
    return this.events.filter((event) => event.type === type);
  }
}
