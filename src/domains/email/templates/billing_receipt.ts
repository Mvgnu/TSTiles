import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const billingReceiptHandler: EmailTemplateHandler = {
  templateKey: "billing_receipt",
  subject: "Your TSTiles invoice receipt",
  validateParams(params) {
    return validateRequiredParams(params, ["amount", "invoiceUrl"]);
  },
  renderHtml(params) {
    const rawAmount = String(params.amount);
    const amount = escapeHtml(rawAmount);
    const invoiceUrl = escapeHtml(params.invoiceUrl);
    const content = `
      <h1>Payment Received</h1>
      <p>Thank you for your business. We have successfully processed your payment of <strong>${amount}</strong>.</p>
      <p>You can view and download your full invoice receipt using the link below.</p>
      <a href="${invoiceUrl}" class="btn">View Invoice Receipt</a>
      <p class="muted">If you have any questions regarding this invoice, please reach out to our billing team.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `Invoice payment of ${rawAmount} received.` });
  },
  renderText(params) {
    const amount = String(params.amount);
    const invoiceUrl = String(params.invoiceUrl);
    return `Payment Received\n\nThank you for your business. We have successfully processed your payment of ${amount}.\n\nYou can view and download your full invoice receipt here:\n\n${invoiceUrl}\n\nIf you have any questions regarding this invoice, please reach out to our billing team.\n\n--\nThe TSTiles Team`;
  },
};
