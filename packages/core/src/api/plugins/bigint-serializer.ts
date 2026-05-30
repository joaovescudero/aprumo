// bigint-serializer.ts — Fastify serializer compiler that handles BigInt → string.
//
// Per RESEARCH.md Pattern 1 and API-02:
//   Native JSON.stringify(bigint) throws TypeError.
//   setSerializerCompiler replaces the serializer factory so that every route's
//   serializer uses JSON.stringify with a replacer that converts BigInt to its
//   decimal string representation.
//
// This function must be called BEFORE any route registration so that all route
// handlers benefit from the replacement serializer.
//
// Reference: fastify.dev/docs/latest/Reference/Validation-and-Serialization/

import type { FastifyInstance } from "fastify";

/**
 * JSON.stringify replacer that converts BigInt values to decimal strings.
 * Used by both the serializer compiler (schema-validated routes) and the
 * reply serializer (schema-less routes / fallback).
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Register a global BigInt → string serializer on the Fastify instance.
 *
 * Two-layer approach to ensure BigInt serialization applies universally:
 *
 * 1. `setSerializerCompiler` — replaces Fastify's fast-json-stringify compiler for
 *    routes WITH a response schema. Each schema-validated route gets a compiled
 *    serializer function that uses the BigInt replacer. This is the primary path
 *    for all production routes (TypeBox schemas define response shapes).
 *    Reference: fastify.dev/docs/latest/Reference/Validation-and-Serialization/
 *
 * 2. `setReplySerializer` — global fallback for routes WITHOUT a response schema
 *    (e.g. test-only routes, error responses, or any route that calls reply.send()
 *    without a defined response schema). Without this, Fastify falls back to native
 *    JSON.stringify which throws TypeError on BigInt.
 *
 * Both must be called before any route registration.
 */
export function registerBigIntSerializer(app: FastifyInstance): void {
  // Primary: schema-validated routes (TypeBox response schemas on all production routes).
  app.setSerializerCompiler(() => (data) => JSON.stringify(data, bigIntReplacer));

  // Fallback: schema-less routes and direct reply.send() calls.
  // setReplySerializer does NOT bypass setSerializerCompiler — they cover disjoint cases:
  // schema present → setSerializerCompiler; schema absent → setReplySerializer.
  app.setReplySerializer((payload) => JSON.stringify(payload, bigIntReplacer));
}
