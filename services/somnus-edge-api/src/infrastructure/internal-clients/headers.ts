/**
 * Wire header carrying the resolved internal Somnus user id to private
 * services. Mirrors identity's `ACTOR_ID_HEADER`
 * (common/decorators/current-actor.decorator.ts) -- a cross-service
 * contract pinned by the edge <-> identity contract test, declared here
 * independently so edge-api never imports another service's code.
 */
export const ACTOR_ID_HEADER = "x-somnus-actor-id";
