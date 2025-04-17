/**
 * Email module.
 * 
 * (C) 2020 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */
const crypt = require(CONSTANTS.LIBDIR+"/crypt.js");
const conf = require(`${APP_CONSTANTS.CONF_DIR}/smtp.json`);
const serverMailer = require(CONSTANTS.LIBDIR+"/mailer.js");
const nodemailer = require("nodemailer");
const mailgunTransport = require("nodemailer-mailgun-transport");

module.exports.email = async function(to, title, email_html, email_text) {
    const auth = conf.useMailGunAPI ? {auth: { api_key: crypt.decrypt(conf.apikey), domain: conf.domain }} : {user: conf.user, pass: crypt.decrypt(conf.password)};
    const smtpConfig = conf.useMailGunAPI ? {from: conf.from} : {server: conf.server, port: conf.port, secure: conf.secure, from: conf.from};
    return (conf.useMailGunAPI ? await sendEmail(to, title, email_html, email_text, smtpConfig, auth) : await serverMailer.email(to, title, email_html, email_text, smtpConfig, auth));
}

async function sendEmail(to, title, email_html, email_text, conf, auth) {
    const transporter = nodemailer.createTransport(mailgunTransport(auth));

    try {
        const result = await transporter.sendMail({"from": conf.from, "to": to, "subject": title, "text": email_text, "html": email_html});
        LOG.info(`Email sent to ${to} with title ${title} from ${conf.from} with ID ${result.messageId}. Other SMTP information is ${JSON.stringify(result)}.`);
        return true;
    } catch (err) {
        LOG.error(`Email send failed due to ${err}`);
        return false;
    }
}