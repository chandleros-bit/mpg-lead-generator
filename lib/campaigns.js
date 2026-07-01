function footer(personal) {
  const f = personal.canspam_footer;
  return `\n\n—\n${personal.name}, ${personal.company}\n${f.business_address}\n${f.optout_line}`;
}

function displacement(lead, personal) {
  const name = lead.business.name;
  const vertical = lead.business.category.replace(/_/g, " ");
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;

  return {
    place_id: lead.business.place_id,
    email1_subject: `Quick question about card processing at ${name}`,
    email1_body:
      `Hi ${name} team,\n\n` +
      `I work with ${vertical} businesses around Houston on their card ` +
      `processing, and a couple of your reviews caught my eye. Would you be ` +
      `open to a two-minute look at your current effective rate? Most ` +
      `${vertical}s I review are overpaying and don't realize it — no ` +
      `long-term contract on our side either.\n\n` +
      `Worth a quick look?\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: card processing at ${name}`,
    email2_body:
      `Hi again,\n\n` +
      `One concrete thing: if you're on flat-rate pricing (Square, Clover, ` +
      `and similar), switching to interchange-plus usually drops the ` +
      `effective rate noticeably at your volume. I'm happy to read your ` +
      `latest statement and tell you straight whether it's worth changing.\n\n` +
      `Reply here or call/text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name} — ${who} with ${company}. Saw your spot and think you may be ` +
      `overpaying on card fees. Open to a quick rate check? No contract.`,
    voicemail:
      `Hi, this is ${who} with ${company}. I help local ${vertical}s cut their ` +
      `card-processing costs without locking into a contract. If you'd like a ` +
      `free rate review, call me back at ${personal.callback_number}. Thanks!`,
  };
}

function greenfield(lead, personal) {
  const name = lead.business.name;
  const vertical = lead.business.category.replace(/_/g, " ");
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;

  return {
    place_id: lead.business.place_id,
    email1_subject: `Congrats on ${name} — payments set up right`,
    email1_body:
      `Hi ${name} team,\n\n` +
      `Congrats on the new ${vertical}! When you're getting set up to take ` +
      `cards, the choices you make now are hard to undo later. I help new ` +
      `Houston businesses start on transparent pricing and the right hardware ` +
      `from day one.\n\n` +
      `Want a quick rundown of what to look for?\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: getting ${name} ready to take cards`,
    email2_body:
      `Hi again,\n\n` +
      `Quick tip for a new ${vertical}: avoid leased terminals and flat-rate ` +
      `lock-ins — they're easy to sign up for and expensive to leave. I can ` +
      `walk you through getting started on interchange-plus with EMV/NFC ` +
      `hardware so you're ready for chip and tap on opening day.\n\n` +
      `Reply here or call/text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name} — ${who} with ${company}. Congrats on opening! Happy to help ` +
      `you get card payments set up right from the start. Want a quick tip sheet?`,
    voicemail:
      `Hi, this is ${who} with ${company}. Congratulations on the new ${vertical}! ` +
      `I help new businesses get payments set up right the first time. Give me ` +
      `a call back at ${personal.callback_number} whenever's good. Thanks!`,
  };
}

export function generateCampaign(lead, personal) {
  return lead.track === "greenfield" ? greenfield(lead, personal) : displacement(lead, personal);
}
