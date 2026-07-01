from mpg_leads.models import Campaign, ScoredLead


def _footer(personal):
    f = personal["canspam_footer"]
    return f"\n\n—\n{personal['name']}, {personal['company']}\n" \
           f"{f['business_address']}\n{f['optout_line']}"


def _displacement(lead, personal):
    name = lead.business.name
    vertical = lead.business.category.replace("_", " ")
    footer = _footer(personal)
    who = personal["name"]
    company = personal["company"]

    email1_subject = f"Quick question about card processing at {name}"
    email1_body = (
        f"Hi {name} team,\n\n"
        f"I work with {vertical} businesses around Houston on their card "
        f"processing, and a couple of your reviews caught my eye. Would you be "
        f"open to a two-minute look at your current effective rate? Most "
        f"{vertical}s I review are overpaying and don't realize it — no "
        f"long-term contract on our side either.\n\n"
        f"Worth a quick look?\n\n{who}, {company}"
        f"{footer}"
    )
    email2_subject = f"Re: card processing at {name}"
    email2_body = (
        f"Hi again,\n\n"
        f"One concrete thing: if you're on flat-rate pricing (Square, Clover, "
        f"and similar), switching to interchange-plus usually drops the "
        f"effective rate noticeably at your volume. I'm happy to read your "
        f"latest statement and tell you straight whether it's worth changing.\n\n"
        f"Reply here or call/text {personal['callback_number']}.\n\n{who}"
        f"{footer}"
    )
    sms = (
        f"Hi {name} — {who} with {company}. Saw your spot and think you may be "
        f"overpaying on card fees. Open to a quick rate check? No contract."
    )
    voicemail = (
        f"Hi, this is {who} with {company}. I help local {vertical}s cut their "
        f"card-processing costs without locking into a contract. If you'd like a "
        f"free rate review, call me back at {personal['callback_number']}. Thanks!"
    )
    return Campaign(lead.business.place_id, email1_subject, email1_body,
                    email2_subject, email2_body, sms, voicemail)


def _greenfield(lead, personal):
    name = lead.business.name
    vertical = lead.business.category.replace("_", " ")
    footer = _footer(personal)
    who = personal["name"]
    company = personal["company"]

    email1_subject = f"Congrats on {name} — payments set up right"
    email1_body = (
        f"Hi {name} team,\n\n"
        f"Congrats on the new {vertical}! When you're getting set up to take "
        f"cards, the choices you make now are hard to undo later. I help new "
        f"Houston businesses start on transparent pricing and the right hardware "
        f"from day one.\n\n"
        f"Want a quick rundown of what to look for?\n\n{who}, {company}"
        f"{footer}"
    )
    email2_subject = f"Re: getting {name} ready to take cards"
    email2_body = (
        f"Hi again,\n\n"
        f"Quick tip for a new {vertical}: avoid leased terminals and flat-rate "
        f"lock-ins — they're easy to sign up for and expensive to leave. I can "
        f"walk you through getting started on interchange-plus with EMV/NFC "
        f"hardware so you're ready for chip and tap on opening day.\n\n"
        f"Reply here or call/text {personal['callback_number']}.\n\n{who}"
        f"{footer}"
    )
    sms = (
        f"Hi {name} — {who} with {company}. Congrats on opening! Happy to help "
        f"you get card payments set up right from the start. Want a quick tip sheet?"
    )
    voicemail = (
        f"Hi, this is {who} with {company}. Congratulations on the new {vertical}! "
        f"I help new businesses get payments set up right the first time. Give me "
        f"a call back at {personal['callback_number']} whenever's good. Thanks!"
    )
    return Campaign(lead.business.place_id, email1_subject, email1_body,
                    email2_subject, email2_body, sms, voicemail)


def generate_campaign(lead: ScoredLead, personal: dict) -> Campaign:
    if lead.track == "greenfield":
        return _greenfield(lead, personal)
    return _displacement(lead, personal)
