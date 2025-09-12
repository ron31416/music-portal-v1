// src/app/api/version/route.ts
export const dynamic = "force-static";
import pkg from "../../../../package.json" assert { type: "json" };

export async function GET() {
  return Response.json({
    name: pkg.name,
    version: pkg.version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
