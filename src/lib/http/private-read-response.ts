import { NextResponse } from "next/server";
import {
  databaseReadUnavailableResult,
  privateReadHeaders,
} from "./private-read-policy";

export { privateReadHeaders } from "./private-read-policy";

export function privateReadJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: privateReadHeaders,
    status,
  });
}

export function databaseReadUnavailableResponse(message = "Data is temporarily unavailable.") {
  const result = databaseReadUnavailableResult(message);
  return privateReadJson(result.body, result.status);
}
