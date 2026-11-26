// Prints an ADMIN_PASSWORD_HASH line for the instance configuration.
//
// On a terminal it asks for the password twice without echoing it, so the
// password never lands in the shell history. Without a terminal it reads one
// line from stdin, which allows piping. Prompts and errors go to stderr; stdout
// carries only the resulting line.
//
// Run by plain `node` (type stripping): erasable syntax and relative imports
// with the `.ts` extension only.

import { createInterface } from "node:readline";
import { Writable } from "node:stream";

import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../src/lib/auth/password-hash.ts";

class InterruptedError extends Error {}

// Asks one question on the terminal; readline echoes into a muted stream, so
// typed characters are not shown while line editing still works.
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    let answered = false;

    // Closing the interface also takes the terminal out of raw mode, so echo
    // comes back even when the process is stopped by a signal mid-prompt.
    const stop = (): void => {
      rl.close();
    };
    rl.on("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.once("SIGHUP", stop);
    rl.on("close", () => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGHUP", stop);
      process.stderr.write("\n");
      if (!answered) {
        reject(new InterruptedError());
      }
    });

    process.stderr.write(prompt);
    rl.question("", (answer) => {
      answered = true;
      resolve(answer);
      rl.close();
    });
  });
}

// Reads stdin to the end and returns its first line without the line ending,
// or null when stdin is empty.
async function readFirstLine(): Promise<string | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") {
    return null;
  }
  const end = text.indexOf("\n");
  const line = end === -1 ? text : text.slice(0, end);
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  let password: string;

  if (process.stdin.isTTY) {
    try {
      password = await askHidden("Hasło: ");
      const repeated = await askHidden("Powtórz hasło: ");
      if (password !== repeated) {
        fail("Hasła nie są zgodne.");
      }
    } catch (error) {
      if (error instanceof InterruptedError) {
        fail("Przerwano.");
      }
      throw error;
    }
  } else {
    const line = await readFirstLine();
    if (line === null) {
      fail("Brak hasła na wejściu.");
    }
    password = line;
  }

  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    fail(`Hasło musi mieć od ${PASSWORD_MIN_LENGTH} do ${PASSWORD_MAX_LENGTH} znaków.`);
  }

  const hash = await hashPassword(password);
  process.stdout.write(`ADMIN_PASSWORD_HASH=${hash}\n`);
}

await main();
