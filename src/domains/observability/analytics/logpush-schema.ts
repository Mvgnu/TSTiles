export interface LogpushRecord {
  readonly datetime: string;
  readonly zone: string;
  readonly requestPath: string;
  readonly statusCode: number;
  readonly cfEdgeColo: string;
}
