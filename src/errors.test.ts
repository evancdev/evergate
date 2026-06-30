import { describe, it, expect } from "vitest";
import neo4j from "neo4j-driver";
import { needsImplicitTx } from "./errors.js";

// All messages + codes are real Neo4j errors (CALL-IN-TX / PERIODIC-COMMIT verified on a live
// 5.26.27; the other codes occur on other versions/editions). Casing is fixed, so matching is case-sensitive.

// v6's Neo4jError constructor types `code` narrowly and requires gql fields — hence the cast + "".
const err = (code: string, message: string) =>
  new neo4j.Neo4jError(message, code as never, "", "");

const CALL_IN_TX_MSG =
  "A query with 'CALL { ... } IN TRANSACTIONS' can only be executed in an implicit transaction, but tried to execute in an explicit transaction.";

const PERIODIC_COMMIT_MSG =
  "Executing stream that use periodic commit in an open transaction is not possible.";

describe("needsImplicitTx", () => {
  it("matches CALL IN TRANSACTIONS (TransactionStartFailed)", () => {
    expect(
      needsImplicitTx(
        err(
          "Neo.DatabaseError.Transaction.TransactionStartFailed",
          CALL_IN_TX_MSG,
        ),
      ),
    ).toBe(true);
  });

  it("matches CALL IN TRANSACTIONS (ExecutionFailed)", () => {
    expect(
      needsImplicitTx(
        err("Neo.DatabaseError.Statement.ExecutionFailed", CALL_IN_TX_MSG),
      ),
    ).toBe(true);
  });

  it("matches CALL IN TRANSACTIONS (SemanticError)", () => {
    expect(
      needsImplicitTx(
        err("Neo.ClientError.Statement.SemanticError", CALL_IN_TX_MSG),
      ),
    ).toBe(true);
  });

  it("matches periodic commit in an open transaction (SemanticError)", () => {
    expect(
      needsImplicitTx(
        err("Neo.ClientError.Statement.SemanticError", PERIODIC_COMMIT_MSG),
      ),
    ).toBe(true);
  });

  it("ignores unrelated Neo4j errors", () => {
    expect(
      needsImplicitTx(
        err(
          "Neo.ClientError.Statement.SyntaxError",
          "Invalid input near WHERE",
        ),
      ),
    ).toBe(false);
  });

  it("ignores the deceptive 'after a write clause' SemanticError (same code + IN TRANSACTIONS tokens)", () => {
    expect(
      needsImplicitTx(
        err(
          "Neo.ClientError.Statement.SemanticError",
          "CALL { ... } IN TRANSACTIONS after a write clause is not supported",
        ),
      ),
    ).toBe(false);
  });

  it("ignores the 5.26 PERIODIC COMMIT removal SyntaxError (names both constructs)", () => {
    expect(
      needsImplicitTx(
        err(
          "Neo.ClientError.Statement.SyntaxError",
          "The PERIODIC COMMIT query hint is no longer supported. Please use CALL { ... } IN TRANSACTIONS instead.",
        ),
      ),
    ).toBe(false);
  });

  it.each([
    "Neo.TransientError.Transaction.DeadlockDetected",
    "Neo.TransientError.Transaction.Terminated",
    "ServiceUnavailable",
    "SessionExpired",
  ])("ignores transient/connectivity error %s", (code) => {
    expect(needsImplicitTx(err(code, "transient failure"))).toBe(false);
  });

  it("requires both code and message (real message, non-matching code)", () => {
    expect(
      needsImplicitTx(
        err("Neo.ClientError.Security.Forbidden", CALL_IN_TX_MSG),
      ),
    ).toBe(false);
  });

  it("requires a message (matching code, empty message)", () => {
    expect(
      needsImplicitTx(
        err("Neo.DatabaseError.Transaction.TransactionStartFailed", ""),
      ),
    ).toBe(false);
  });

  it("returns false for non-Neo4jError values", () => {
    expect(needsImplicitTx(new Error(CALL_IN_TX_MSG))).toBe(false);
    expect(
      needsImplicitTx({
        code: "Neo.DatabaseError.Statement.ExecutionFailed",
        message: CALL_IN_TX_MSG,
      }),
    ).toBe(false);
    expect(needsImplicitTx(null)).toBe(false);
    expect(needsImplicitTx(undefined)).toBe(false);
  });
});
