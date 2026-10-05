import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

const ffmpeg = (ffmpegStatic as unknown as string) ?? "ffmpeg";

export async function wavToOggOpus(wav: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      "-i", "pipe:0",
      "-vn",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-ar", "48000",
      "-ac", "1",
      "-f", "ogg",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.stderr.resume();
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });

    p.stdin.end(wav);
  });
}
