export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  refreshTokenExpiresInDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS ?? "30", 10),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",

  storage: {
    type: (process.env.STORAGE_TYPE ?? "local") as "local" | "s3",
    localPath: process.env.STORAGE_LOCAL_PATH ?? "./uploads",
    s3: {
      bucket: process.env.S3_BUCKET ?? "clinscriptum",
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  },
} as const;
