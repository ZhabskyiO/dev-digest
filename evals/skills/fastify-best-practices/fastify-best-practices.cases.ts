import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "new route is schema-first, lives in an encapsulated plugin, and is tested with inject()",
    kind: "quality",
    prompt:
      "Add a Fastify 5 route POST /reviews/:id/rerun to our TypeScript API. It takes a JSON body " +
      "{ reason: string } and returns { runId: string }. Show how you'd structure it, validate it, handle a " +
      "not-found error, and test it without starting a server.",
    practices: [
      "the route declares a schema for params, body and response (JSON Schema or a type provider such as fastify-type-provider-zod) instead of validating by hand inside the handler",
      "the route is registered inside a plugin function (encapsulation), e.g. async function reviewsRoutes(app) { app.post(...) } registered with app.register(...)",
      "the not-found case is handled by replying with a proper status code (404) via an error handler or reply.code(404), not by returning 200 with an error field",
      "the test uses app.inject({ method: 'POST', url: '/reviews/abc/rerun', payload: {...} }) rather than app.listen + an HTTP client",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
