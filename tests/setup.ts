import { beforeEach } from "vitest";
import { prisma } from "../src/config/db";

beforeEach(async () => {
  await prisma.apiKey.deleteMany();
  await prisma.usageBucket.deleteMany();
  await prisma.globalBudgetBucket.deleteMany();
  await prisma.billingSnapshot.deleteMany();
  await prisma.checkoutSession.deleteMany();
  await prisma.project.deleteMany();
});
