import { withAccelerate } from "@prisma/extension-accelerate";
// import { PrismaClient } from "../app/generated/prisma";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

const prisma =
  globalForPrisma.prisma || new PrismaClient().$extends(withAccelerate());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

// import { PrismaClient } from "@prisma/client";

// let prisma: PrismaClient;
// const globalForPrisma = global as unknown as {
//   prisma: PrismaClient;
// };
// if (process.env.NODE_ENV === "production") {
//   prisma = new PrismaClient();
// } else {
//   if (!globalForPrisma.prisma) {
//     globalForPrisma.prisma = new PrismaClient();
//   }
//   prisma = globalForPrisma.prisma;
// }

// export default prisma;
