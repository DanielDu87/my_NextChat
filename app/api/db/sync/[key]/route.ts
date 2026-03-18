import { NextRequest, NextResponse } from "next/server";
import {
  getStoreSnapshot,
  isSupportedStoreKey,
  setStoreSnapshot,
} from "@/app/utils/server/sync-store-repository";

export const runtime = "nodejs";

type Params = {
  params: {
    key: string;
  };
};

export async function GET(_: NextRequest, { params }: Params) {
  try {
    if (!isSupportedStoreKey(params.key)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_store_key" },
        { status: 400 },
      );
    }

    const payload = await getStoreSnapshot(params.key);
    if (payload === undefined) {
      return new Response("", { status: 200 });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    if (!isSupportedStoreKey(params.key)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_store_key" },
        { status: 400 },
      );
    }

    const rawBody = await req.text();
    const payload = JSON.parse(rawBody);
    await setStoreSnapshot(params.key, payload);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
