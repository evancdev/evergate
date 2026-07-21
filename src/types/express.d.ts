import "express";

declare global {
  namespace Express {
    interface Request {
      /** The caller's session id, resolved by the requireSession middleware. */
      sessionId: string;
    }
  }
}
