import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_PHONE = '+919111111111';

type ApiEnvelope<T> = {
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type SessionResponse = {
  id: string;
  clinic_id: string;
  language_code: string;
  current_flow: string;
  current_state: string;
};

type MessageResponse = {
  sender: string;
  message_text: string;
  intent: string | null;
  reply_template_key: string | null;
  debug_json?: Record<string, unknown> | null;
};

function apiBaseUrl(): string {
  return (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function clinicId(): string {
  return process.env.CLINIC_ID ?? process.env.DEV_CLINIC_ID ?? DEFAULT_CLINIC_ID;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }

  return body.data as T;
}

function printHelp(): void {
  output.write(`
Commands:
  /new                 Create a new conversation session
  /session <id>        Switch to an existing session id
  /history             Fetch full message history
  /clinic <uuid>       Set clinic id for /new
  /phone <number>      Set patient phone for /new
  /help                Show this help
  /quit                Exit

Any other input is sent as a patient message.
`);
}

function printAssistant(message: MessageResponse): void {
  output.write(`\nassistant> ${message.message_text}\n`);
  const meta = [
    message.intent ? `intent=${message.intent}` : null,
    message.reply_template_key ? `template=${message.reply_template_key}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (meta) {
    output.write(`           (${meta})\n`);
  }

  const debug = message.debug_json;
  if (debug && typeof debug === 'object') {
    const agentStatus = (debug as { agent_llm_status?: string }).agent_llm_status;
    const agentFallback = (debug as { agent_fallback?: { message?: string; reason?: string } })
      .agent_fallback;
    if (agentStatus === 'success') {
      output.write('           agent_llm=success\n');
    } else if (agentStatus === 'failed') {
      output.write(
        `           agent_llm=FAILED: ${agentFallback?.message ?? agentFallback?.reason ?? 'unknown error'}\n`,
      );
    }
  }

  if (message.debug_json) {
    output.write(`           debug=${JSON.stringify(message.debug_json)}\n`);
  }
}

async function createSession(currentClinicId: string, phone: string): Promise<SessionResponse> {
  return api<{ session: SessionResponse }>('/v1/conversations', {
    method: 'POST',
    body: JSON.stringify({
      clinic_id: currentClinicId,
      channel: 'admin_test',
      patient_phone: phone,
    }),
  }).then((data) => data.session);
}

async function sendMessage(sessionId: string, text: string): Promise<void> {
  const idempotencyKey = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const data = await api<{
    assistant_message: MessageResponse;
    session: SessionResponse;
  }>(`/v1/conversations/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      message_text: text,
      idempotency_key: idempotencyKey,
    }),
  });

  printAssistant(data.assistant_message);
  output.write(
    `           session=${data.session.language_code} ${data.session.current_flow}/${data.session.current_state}\n`,
  );
}

async function printHistory(sessionId: string): Promise<void> {
  const data = await api<{ session: SessionResponse; messages: MessageResponse[] }>(
    `/v1/conversations/${sessionId}`,
  );

  output.write(`\nSession ${data.session.id} (${data.session.language_code})\n`);
  for (const message of data.messages) {
    output.write(`${message.sender}> ${message.message_text}\n`);
  }
  output.write('\n');
}

async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  let sessionId: string | null = null;
  let currentClinicId = clinicId();
  let phone = process.env.PATIENT_PHONE ?? DEFAULT_PHONE;

  output.write(`Vaidya conversation console\nAPI: ${apiBaseUrl()}\nClinic: ${currentClinicId}\n`);
  printHelp();

  try {
    sessionId = (await createSession(currentClinicId, phone)).id;
    output.write(`Created session ${sessionId}\n`);
  } catch (error) {
    output.write(`Could not create session: ${(error as Error).message}\n`);
    output.write('Use /new after starting the API and database.\n');
  }

  while (true) {
    const line = (await rl.question(sessionId ? `\npatient> ` : `\nconsole> `)).trim();
    if (!line) {
      continue;
    }

    if (line === '/quit' || line === '/exit') {
      break;
    }

    if (line === '/help') {
      printHelp();
      continue;
    }

    if (line === '/new') {
      try {
        sessionId = (await createSession(currentClinicId, phone)).id;
        output.write(`Created session ${sessionId}\n`);
      } catch (error) {
        output.write(`Error: ${(error as Error).message}\n`);
      }
      continue;
    }

    if (line.startsWith('/session ')) {
      sessionId = line.slice('/session '.length).trim();
      output.write(`Using session ${sessionId}\n`);
      continue;
    }

    if (line === '/history') {
      if (!sessionId) {
        output.write('No active session.\n');
        continue;
      }
      try {
        await printHistory(sessionId);
      } catch (error) {
        output.write(`Error: ${(error as Error).message}\n`);
      }
      continue;
    }

    if (line.startsWith('/clinic ')) {
      currentClinicId = line.slice('/clinic '.length).trim();
      output.write(`Clinic set to ${currentClinicId}\n`);
      continue;
    }

    if (line.startsWith('/phone ')) {
      phone = line.slice('/phone '.length).trim();
      output.write(`Patient phone set to ${phone}\n`);
      continue;
    }

    if (!sessionId) {
      output.write('No active session. Run /new first.\n');
      continue;
    }

    try {
      await sendMessage(sessionId, line);
    } catch (error) {
      output.write(`Error: ${(error as Error).message}\n`);
    }
  }

  rl.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
