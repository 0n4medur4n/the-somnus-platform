import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminCapabilityGuard } from "../../src/modules/admin/admin-capability.guard.js";
import { ADMIN_ROUTE_KEY } from "../../src/modules/admin/admin-route.decorator.js";
import { buildTestApp, type TestApp } from "../support/app.js";

const METHOD_NAME: Record<number, string> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.OPTIONS]: "OPTIONS",
  [RequestMethod.HEAD]: "HEAD",
  [RequestMethod.ALL]: "ALL",
};

type DeclaredRoute = { method: string; url: string };

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [""];
}

function joinRoute(controllerPath: string, methodPath: string): string {
  const left = controllerPath.startsWith("/") ? controllerPath : `/${controllerPath}`;
  const right =
    methodPath === "" || methodPath === "/"
      ? ""
      : methodPath.startsWith("/")
        ? methodPath
        : `/${methodPath}`;
  return `${left.replace(/\/+$/, "")}${right}`.replace(/\/{2,}/g, "/") || "/";
}

/**
 * Every controller method on the booted app whose path is `/admin/v1`.
 * `hasRoute` then checks the router actually registered that method and url.
 * A handler without the console guard, or without its route declaration,
 * fails before the list is returned.
 */
function declaredAdminRoutes(app: NestFastifyApplication): DeclaredRoute[] {
  const routes: DeclaredRoute[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const controller of module.controllers.values()) {
      const metatype = controller.metatype;
      if (metatype === null || metatype === undefined) continue;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, metatype) ?? []) as unknown[];
      const prototype = metatype.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== "function" || name === "constructor") continue;
        const methodMeta = Reflect.getMetadata(METHOD_METADATA, handler) as unknown;
        if (methodMeta === undefined) continue;
        const methods = (Array.isArray(methodMeta) ? methodMeta : [methodMeta]) as number[];
        const classMeta = Reflect.getMetadata(ADMIN_ROUTE_KEY, metatype) as unknown;
        const handlerMeta = Reflect.getMetadata(ADMIN_ROUTE_KEY, handler) as unknown;
        const guards = [
          ...classGuards,
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
        ];
        const covered =
          guards.includes(AdminCapabilityGuard) && (handlerMeta ?? classMeta) !== undefined;
        for (const controllerPath of asList(Reflect.getMetadata(PATH_METADATA, metatype))) {
          for (const methodPath of asList(Reflect.getMetadata(PATH_METADATA, handler))) {
            const url = joinRoute(controllerPath, methodPath);
            if (!url.startsWith("/admin/v1")) continue;
            if (!covered) {
              throw new Error(`${metatype.name}.${name} ${url} has no console-session check`);
            }
            for (const method of methods) {
              routes.push({ method: METHOD_NAME[method] ?? String(method), url });
            }
          }
        }
      }
    }
  }
  return routes;
}

describe("registered /admin/v1 routes", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("sends every one through AdminCapabilityGuard", () => {
    const routes = declaredAdminRoutes(testApp.app);
    expect(routes.length).toBeGreaterThan(0);
    const missing = routes.filter(
      (route) => !testApp.server.hasRoute({ method: route.method, url: route.url }),
    );
    expect(missing).toEqual([]);
    expect(testApp.server.printRoutes()).toContain("admin/v1");
  });
});
