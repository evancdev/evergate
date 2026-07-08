import neo4j from "neo4j-driver";

/** The X-Hermes-Agent header was absent or blank, so the caller can't be identified. */
export class MissingIdentityError extends Error {}

/** True if the statement must run in an implicit transaction. */
export function needsImplicitTx(err: unknown): boolean {
  if (!(err instanceof neo4j.Neo4jError)) return false;
  const msg = err.message ?? "";
  return (
    ((err.code === "Neo.DatabaseError.Statement.ExecutionFailed" ||
      err.code === "Neo.DatabaseError.Transaction.TransactionStartFailed") &&
      /in an implicit transaction/.test(msg)) ||
    (err.code === "Neo.ClientError.Statement.SemanticError" &&
      (/in an open transaction is not possible/.test(msg) ||
        /tried to execute in an explicit transaction/.test(msg)))
  );
}
