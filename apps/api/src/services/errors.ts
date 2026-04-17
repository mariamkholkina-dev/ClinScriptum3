export type DomainErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "PRECONDITION_FAILED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
