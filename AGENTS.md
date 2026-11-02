# Agent Instructions

The canonical maintenance and regression rules for this repository are in [Agent.md](./Agent.md).

Mandatory before claiming a feature is complete:

1. Read `Agent.md`.
2. Add or update tests for every changed feature:
   - pure logic → `apps/api/src/**/*.spec.ts`
   - API behavior → `scripts/regression-api.mjs`
   - page behavior → `scripts/regression-ui.mjs`
3. Update `docs/测试矩阵.md`.
4. Run `pnpm test:regression` and require 0 failures.
5. Never skip or delete assertions to make a regression pass.
6. All Docker images must start with `docker.m.daocloud.io/`.
