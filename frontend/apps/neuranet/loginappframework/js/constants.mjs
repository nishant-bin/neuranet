/* 
 * (C) 2015 TekMonks. All rights reserved.
 * License: MIT - see enclosed license.txt file.
 */
const FRONTEND = "https://{{{hostname}}}";
const BACKEND = "https://{{{hostname}}}:9090";
const APP_NAME = "neuranet";
const EMBEDDED_APP_NAME = "neuranetapp";
const APP_PATH = `${FRONTEND}/apps/${APP_NAME}`;
const EMBEDDED_APP_PATH = `${APP_PATH}/${EMBEDDED_APP_NAME}`;
const LOGINAPP_PATH = `${APP_PATH}/loginappframework`;
const CONF_PATH = `${LOGINAPP_PATH}/conf`;
const COMPONENTS_PATH = `${LOGINAPP_PATH}/components`;
const API_PATH = `${BACKEND}/apps/${APP_NAME}`;

export const APP_CONSTANTS = {
    FRONTEND, BACKEND, APP_PATH, APP_NAME, COMPONENTS_PATH, API_PATH, CONF_PATH, LOGINAPP_PATH, 
    EMBEDDED_APP_NAME, EMBEDDED_APP_PATH,

    MAIN_HTML: LOGINAPP_PATH+"/main.html",
    LOGIN_HTML: LOGINAPP_PATH+"/login.html",
    INDEX_HTML: LOGINAPP_PATH+"/index.html",
    REGISTER_HTML: LOGINAPP_PATH+"/register.html",
    LOGIN_ROOM_HTML: LOGINAPP_PATH+"/loginroom.html",
    ERROR_HTML: LOGINAPP_PATH+"/error.html",
    MANAGE_HTML: LOGINAPP_PATH+"/manage.html",
    VERIFY_HTML: LOGINAPP_PATH+"/verify.html",
    DOWNLOAD_HTML: LOGINAPP_PATH+"/download.html",

    DIALOGS_PATH: LOGINAPP_PATH+"/dialogs",

    LOGINFRAMEWORK_LIB_PATH: LOGINAPP_PATH+"/js",

    SESSION_NOTE_ID: "com_monkshu_ts",

    // Login constants
    MIN_PASS_LENGTH: 8,
    API_LOGIN: API_PATH+"/login",
    API_RESET: API_PATH+"/resetuser",
    API_REGISTER: API_PATH+"/register",
    API_UPDATE: API_PATH+"/updateuser",
    API_VERIFY_EMAIL: API_PATH+"/verifyemail",

    API_STATUS: API_PATH+"/setstatus",
    API_CHANGEPW: API_PATH+"/changepassword",
    API_VALIDATE_TOTP: API_PATH+"/validatetotp",
    API_GETTOTPSEC: API_PATH+"/gettotpsec",
    API_GETPROFILE: API_PATH+"/getprofile",
    USERID: "userid",
    PWPH: "pwph",
    TIMEOUT: 600000,
    USERNAME: "username",
    USERORG: "userorg",
    USERORGDOMAIN: "userorgdomain",
    USER_NEEDS_VERIFICATION: "userneedsverification",
    LOGIN_RESPONSE: "loginresponse",

    USER_ROLE: "user",
    GUEST_ROLE: "guest",
    ADMIN_ROLE: "admin",
    PERMISSIONS_MAP: {
        user:[window.location.origin, LOGINAPP_PATH+"/index.html", 
            LOGINAPP_PATH+"/download.html", LOGINAPP_PATH+"/error.html", LOGINAPP_PATH+"/verify.html", 
            LOGINAPP_PATH+"/main.html", LOGINAPP_PATH+"/reset.html", LOGINAPP_PATH+"/initiallogin.html", 
            LOGINAPP_PATH+"/register.html", LOGINAPP_PATH+"/notapproved.html", 
            LOGINAPP_PATH+"/loginroom.html", LOGINAPP_PATH+"/login.html", $$.MONKSHU_CONSTANTS.ERROR_HTML,
            `${EMBEDDED_APP_PATH}/*.html`],

        admin:[window.location.origin, LOGINAPP_PATH+"/index.html", LOGINAPP_PATH+"/download.html", 
            LOGINAPP_PATH+"/error.html", LOGINAPP_PATH+"/verify.html", LOGINAPP_PATH+"/main.html", 
            LOGINAPP_PATH+"/reset.html", LOGINAPP_PATH+"/initiallogin.html", LOGINAPP_PATH+"/register.html", 
            LOGINAPP_PATH+"/notapproved.html", LOGINAPP_PATH+"/loginroom.html", LOGINAPP_PATH+"/login.html", 
            LOGINAPP_PATH+"/manage.html", $$.MONKSHU_CONSTANTS.ERROR_HTML, 
            `${EMBEDDED_APP_PATH}/*.html`],

        guest:[window.location.origin, LOGINAPP_PATH+"/index.html", LOGINAPP_PATH+"/download.html", 
            LOGINAPP_PATH+"/error.html", LOGINAPP_PATH+"/verify.html", LOGINAPP_PATH+"/reset.html", 
            LOGINAPP_PATH+"/initiallogin.html", LOGINAPP_PATH+"/register.html", 
            LOGINAPP_PATH+"/notapproved.html", LOGINAPP_PATH+"/login.html", LOGINAPP_PATH+"/loginroom.html", 
            $$.MONKSHU_CONSTANTS.ERROR_HTML]
    },

    API_KEYS: {"*":"fheiwu98237hjief8923ydewjidw834284hwqdnejwr79389"},
    KEY_HEADER: "X-API-Key"
}