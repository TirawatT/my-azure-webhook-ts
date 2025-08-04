// app/api/azure-devops-webhook/route.js

import prisma from "@/lib/prisma"; // Import Prisma Client
import { NextRequest, NextResponse } from "next/server";
// import nodemailer from "nodemailer"; // ติดตั้ง: npm install nodemailer

// กำหนดให้ Route นี้เป็นแบบ Dynamic และไม่แคช Response (สำคัญสำหรับ Webhook)
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  console.log("Received a POST request to the Azure DevOps Webhook endpoint.");

  let payload;
  try {
    payload = await request.json();
    console.log("Successfully parsed JSON payload.");
  } catch (error) {
    console.error("Error parsing request body as JSON:", error);
    return NextResponse.json(
      // { message: "Invalid JSON payload.", error: error.message },
      { message: "Invalid JSON payload.", error },
      { status: 400 }
    );
  }

  const headers = request.headers;
  const eventType = headers.get("x-azure-devops-event");
  const subscriptionId = headers.get("x-azure-devops-subscription-id");

  // --- (Recommended) ตรวจสอบ Shared Secret เพื่อความปลอดภัย ---
  // คุณต้องตั้งค่า Custom HTTP Header ใน Azure DevOps Service Hook
  // เช่น Header Name: 'X-Webhook-Secret', Value: 'your_secure_secret_key_here'
  const WEBHOOK_SECRET = process.env.AZURE_DEVOPS_WEBHOOK_SECRET;
  const customSecretHeader = headers.get("x-webhook-secret"); // ตรวจสอบชื่อ header ที่คุณตั้ง
  if (WEBHOOK_SECRET && customSecretHeader !== WEBHOOK_SECRET) {
    console.warn("Unauthorized request: Secret mismatch.");
    return NextResponse.json(
      { message: "Unauthorized: Invalid secret." },
      { status: 401 }
    );
  }
  // --------------------------------------------------------

  // --- 1. บันทึกข้อมูล Webhook Payload ลง PostgreSQL โดยใช้ Prisma ---
  try {
    let alertData = {}; // Object เพื่อเก็บข้อมูลเฉพาะที่ต้องการแยกออกมา
    let isAdvancedSecurityAlert = false;

    // ตรวจสอบว่าเป็น Advanced Security Alert หรือไม่ และดึงข้อมูลที่เกี่ยวข้อง
    if (eventType === "ms.advancedSecurity.alert.created" && payload.resource) {
      isAdvancedSecurityAlert = true;
      alertData = {
        alertId: payload.resource.alertId,
        ruleId: payload.resource.ruleId,
        ruleName: payload.resource.ruleName,
        severity: payload.resource.severity,
        state: payload.resource.state,
        repositoryName: payload.resource.repository?.name,
        branch: payload.resource.branch,
        alertUrl: payload.resource.url,
      };
    }

    const newAlertRecord = await prisma.advancedSecurityAlert.create({
      data: {
        eventType: eventType || "unknown",
        subscriptionId: subscriptionId,
        payload: payload, // เก็บ JSON payload ทั้งก้อน
        // ใช้ spread operator เพื่อรวม alertData เข้าไปในข้อมูลที่จะบันทึก
        ...(isAdvancedSecurityAlert && alertData),
      },
    });
    console.log(
      `Webhook payload saved to database with ID: ${newAlertRecord.id}`
    );

    // --- 2. ประมวลผล Payload เพิ่มเติม (เช่น ส่งอีเมล) ---
    if (isAdvancedSecurityAlert && newAlertRecord) {
      const alert = newAlertRecord; // ใช้ข้อมูลที่เพิ่งบันทึกลง DB
      console.log(`--- New Advanced Security Alert Detected ---`);
      console.log(`  Rule: ${alert.ruleName || "N/A"}`);
      console.log(
        `  Severity: ${alert.severity ? alert.severity.toUpperCase() : "N/A"}`
      );
      console.log(`  Repository: ${alert.repositoryName || "N/A"}`);
      console.log(`  Alert URL: ${alert.alertUrl || "N/A"}`);
      console.log(`------------------------------------------`);

      // ส่งอีเมลแจ้งเตือน
      try {
        await sendEmailNotification({
          subject: `[${
            alert.severity ? alert.severity.toUpperCase() : "UNKNOWN"
          }] New ADO Security Alert: ${alert.ruleName}`,
          body: `
            <p>A new Advanced Security alert has been detected:</p>
            <ul>
              <li>**Rule:** ${alert.ruleName || "N/A"}</li>
              <li>**Severity:** ${
                alert.severity ? alert.severity.toUpperCase() : "N/A"
              }</li>
              <li>**Repository:** ${alert.repositoryName || "N/A"}</li>
              <li>**Branch:** ${alert.branch || "N/A"}</li>
              <li>**Alert State:** ${alert.state || "N/A"}</li>
            </ul>
            <p><a href="${
              alert.alertUrl
            }">View Alert Details in Azure DevOps</a></p>
            <p>Please investigate this alert immediately.</p>
          `,
        });
        console.log("Email notification sent successfully.");
      } catch (emailError) {
        console.error("Failed to send email notification:", emailError);
        // ไม่ส่ง HTTP Error เพื่อให้ Webhook ไม่พยายาม Retry
      }
    } else {
      console.log(`Unhandled event type or missing resource: ${eventType}`);
    }
  } catch (dbAndProcessingError) {
    console.error(
      "Error in database operation or alert processing:",
      dbAndProcessingError
    );
    // ยังคงส่ง 200 OK กลับไปหา Azure DevOps เพื่อป้องกันการ Retry ซ้ำๆ
    // คุณควรตรวจสอบ logs ใน Hosting Platform ของคุณเพื่อดู error นี้
  }

  // 3. ส่งสถานะตอบกลับไปยัง Azure DevOps
  // Azure DevOps คาดหวัง HTTP 200 OK เพื่อยืนยันว่าได้รับ Payload แล้ว
  return NextResponse.json(
    { message: "Webhook received and processed successfully!" },
    { status: 200 }
  );
}

// --- Helper function สำหรับส่งอีเมล ---
// คุณต้องตั้งค่า Environment Variables สำหรับผู้ให้บริการอีเมลของคุณ
async function sendEmailNotification({
  subject,
  body,
}: {
  subject: string;
  body: string;
}) {
  // const transporter = nodemailer.createTransport({
  //   host: process.env.EMAIL_HOST,
  //   port: parseInt(process.env.EMAIL_PORT || "587"),
  //   secure: process.env.EMAIL_SECURE === "true",
  //   auth: {
  //     user: process.env.EMAIL_USER,
  //     pass: process.env.EMAIL_PASSWORD,
  //   },
  // });
  // await transporter.sendMail({
  //   from: process.env.SENDER_EMAIL_ADDRESS,
  //   to: process.env.RECIPIENT_EMAIL_ADDRESS,
  //   subject: subject,
  //   html: body,
  // });
}

// --- (Optional) API Route สำหรับดึงข้อมูลที่เก็บไว้ (เพื่อการ Debug/ตรวจสอบ) ---
// คุณสามารถเข้าถึงได้ที่ /api/azure-devops-webhook (GET request)
export async function GET() {
  // return NextResponse.json({ message: `Hello, GET!` }, { status: 200 });
  try {
    const allAlerts = await prisma.advancedSecurityAlert.findMany({
      orderBy: {
        receivedAt: "desc", // ล่าสุดขึ้นก่อน
      },
      take: 20, // ดึงแค่ 20 รายการล่าสุด
    });
    return NextResponse.json(allAlerts, { status: 200 });
  } catch (error) {
    console.error("Error fetching alerts from database:", error);
    return NextResponse.json(
      // { message: "Failed to fetch alerts.", error: error.message },
      { message: "Failed to fetch alerts.", error },
      { status: 500 }
    );
  }
}
