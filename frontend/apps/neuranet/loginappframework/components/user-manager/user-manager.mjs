/** 
 * A user manager component. Needs corresponding backend api.
 * (C) 2021 TekMonks. All rights reserved.
 * License: See enclosed license file.
 */
import {util} from "/framework/js/util.mjs";
import {i18n} from "/framework/js/i18n.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";
import {monkshu_component} from "/framework/js/monkshu_component.mjs";

const CONTEXT_MENU_ID = "usermanagerContextMenu", API_GETORGUSERS = "getorgusers", API_DELETEUSER = "deleteuser",
	API_APPROVEUSER = "approveuser", API_EDITUSER = "updateuserbyadmin", API_RESETUSER = "resetuser", 
	API_ADDUSER = "adduserbyadmin", COMPONENT_PATH = util.getModulePath(import.meta), API_GETORG = "getorg",
	API_UPDATE_ORG = "addorupdateorg", API_ORGKEYS = "orgkeys";

let conf, mustache_instance;

async function elementConnected(element) {
	conf = await $$.requireJSON(`${COMPONENT_PATH}/conf/usermanager.json`);

	const org = session.get(conf.userorg_session_variable).toString(), id = session.get(conf.userid_session_variable).toString(),
		usersResult = await apiman.rest(`${element.getAttribute("backendurl")}/${API_GETORGUSERS}`, "GET", {org, id}, true);
	if (!usersResult?.result) {LOG.error("Can't fetch the list of users for the org, API returned false.");}

	const users = usersResult?.users||[], data = _createData(element, users);
	user_manager.setDataByHost(element, data);

	user_manager.getMemory(element.id).users = users;

	if (!mustache_instance) mustache_instance = await router.getMustache();
}

async function elementRendered(host, initialRender) {	// for some weird reason we need to set value via JS only
	const memory = user_manager.getMemory(host.id);
	if (!initialRender && memory.filter) user_manager.getShadowRootByHost(host).querySelector("input#searchbox").value = memory.filter;
}

async function searchModified(element) {
	const filter = element.value.trim(), memory = user_manager.getMemoryByContainedElement(element), 
		users = memory.users, filteredUsers = [];

	if (filter != "") {
		for (const user of users) if (user.name.toLowerCase().includes(filter.toLowerCase()) || 
			user.id.toLowerCase().includes(filter.toLowerCase())) filteredUsers.push(user);
	} else filteredUsers.push(...users);

	const data = _createData(user_manager.getHostElement(element), filteredUsers); memory.filter = filter;
	await user_manager.bindData(data, user_manager.getHostElementID(element));
}

async function userMenuClicked(event, element, name, id, _org, role, approved) {
	const CONTEXT_MENU = window.monkshu_env.components["context-menu"];
	const menus = {}; menus[await i18n.get("Edit")] = _=>editUser(name, id, role, approved, element); 
	menus[await i18n.get("Delete")] = _ => _deleteUser(name, id, element); menus[await i18n.get("Reset")] = _ => _resetUser(name, id, element);
	if (approved == 0) menus[await i18n.get("Approve")] = _=>_approveUser(name, id, element);
	CONTEXT_MENU.showMenu(CONTEXT_MENU_ID, menus, event.pageX, event.pageY, 2, 2);
}

async function orgMenuClicked(event, element, org) {
	const CONTEXT_MENU = window.monkshu_env.components["context-menu"];
	const menus = {}; menus[await i18n.get("Edit")] = _=>editOrg(org, element); 
	CONTEXT_MENU.showMenu(CONTEXT_MENU_ID, menus, event.pageX, event.pageY, 2, 2);
}

async function addUser(element) {
	const roles = []; for (const thisrole of conf.roles) roles.push({label:await i18n.get(thisrole), value: thisrole, selected: thisrole==conf.user_role?true:undefined});
	monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/addeditprofile.html`, true, true, 
			{approved: true, roles, CONF:conf, COMPONENT_PATH}, "dialog", ["name", "new_id", "role", "approved"], async ret => {
		
		if (ret.approved.toLowerCase() == "true") ret.approved = true; else ret.approved = false;
		ret.org = session.get(conf.userorg_session_variable).toString(); ret.lang = i18n.getSessionLang(); 
		const backendURL = user_manager.getHostElement(element).getAttribute("backendurl");

		const addResult = await _callBackendAPIShowingSpinner(`${backendURL}/${API_ADDUSER}`, ret);
		if (!addResult?.result) {	// account creation failed
			const errorKey = addResult ? addResult.reason == "exists" ? "Exists" : 
				addResult.reason == "internal" ? "Internal" : addResult.reason == "securityerror" ? "Security" :
				addResult.reason == "domainerror" ? "Domain" :  "Internal" : "Internal";
			const err = await i18n.get(`AddError${errorKey}`); 
			LOG.error(err); monkshu_env.components['dialog-box'].hideDialog("dialog"); _showError(err);
		} else if (!addResult.emailresult) {	// account created but login email send failed
			const err = mustache_instance.render(await i18n.get("AddEmailError"), {name: ret.name, id: ret.id, 
				loginurl: addResult.loginurl}); 
			LOG.error(err); monkshu_env.components['dialog-box'].hideDialog("dialog"); _showError(err);
		} else monkshu_env.components['dialog-box'].hideDialog("dialog");

		user_manager.reload(user_manager.getHostElementID(element));
	});
}

async function editUser(name, old_id, role, approved, element) {
	const roles = []; for (const thisrole of conf.roles) roles.push({label:await i18n.get(thisrole), value: thisrole, selected: thisrole==role?true:undefined});
	monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/addeditprofile.html`, true, true, 
			{name, old_id, role, approved:approved==1?true:undefined, roles, CONF:conf, doNotAllowIDChange: true,
				doNotAllowRoles:old_id==session.get(conf.userid_session_variable).toString()?true:undefined, 
				doNotAllowApproval:old_id==session.get(conf.userid_session_variable).toString()?true:undefined, 
				COMPONENT_PATH}, "dialog", ["name", "new_id", "role", "approved", "old_id"], async ret => {
		
		const req = {...ret, approved: ret.approved.toLowerCase() == "true" ? true:false, 
			id: session.get(conf.userid_session_variable).toString(), org: session.get(conf.userorg_session_variable).toString()}; 
		const backendURL = user_manager.getHostElement(element).getAttribute("backendurl");
		const editResult = await _callBackendAPIShowingSpinner(`${backendURL}/${API_EDITUSER}`, req);
		if (!editResult?.result) {
			const errorKey = editResult ? editResult.reason == "exists" ? "Exists" : editResult.reason == "otp" ?
				"OTP" : editResult.reason == "internal" ? "Internal" : editResult.reason == "securityerror" ? "SecurityError" :
				editResult.reason == "domainerror" ? "DomainError" : editResult.reason == "iddoesntexist" ? "IDNotExistForUpdateError" : 
				"Internal" : "Internal";
			const err = mustache_instance.render(await i18n.get(`EditError${errorKey}`), {name, old_id}); 
			LOG.error(err); monkshu_env.components['dialog-box'].error("dialog", err);
		} else {
			monkshu_env.components['dialog-box'].hideDialog("dialog");
			user_manager.reload(user_manager.getHostElementID(element));
		}
	});
}

async function editOrg(org, element) {
	const _arrayBNotSubsetOfA = (a,b) => (a.length < b.length) || (!b.every(element => a.includes(element)));
	const _array_includes_nocase = (a,b) => a.some(element => element.toString().toLowerCase() == b.toString().toLowerCase());

	const backendURL = user_manager.getHostElement(element).getAttribute("backendurl");
	const orgDetails = await apiman.rest(`${backendURL}/${API_GETORG}`, "GET", {
		id: session.get(conf.userid_session_variable).toString(), org}, true);
	if ((!orgDetails) || (!orgDetails.result)) {const err = await i18n.get("OrgFetchError"); LOG.error(err); _showError(err); return;}

	let dontCheckAutoUserMigrations = false;
	monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/editorg.html`, true, true, 
		{orgname: orgDetails.name, orgaddress: orgDetails.address, orgcontactname: orgDetails.primary_contact_name, 
			orgcontactemail: orgDetails.primary_contact_email, orgdomain: orgDetails.domain, 
			orgnames: JSON.stringify(orgDetails.alternate_names), orgdomains: JSON.stringify(orgDetails.alternate_domains), 
			CONF:conf, COMPONENT_PATH}, 
		"dialog", ["orgname", "orgaddress", "orgcontactname", "orgdomain", "orgcontactemail", "orgnames", "orgdomains"], async ret => {
		
		const _jsonListValuesToStringArray = list => {const retList = []; for (const item of JSON.parse(list)) 
			retList.push(item.label); return retList;}
		ret.orgnames = _jsonListValuesToStringArray(ret.orgnames); ret.orgdomains = _jsonListValuesToStringArray(ret.orgdomains); 
		if (ret.orgname != orgDetails.name) if (!_array_includes_nocase(ret.orgnames, orgDetails.name)) 
			ret.orgnames.push(orgDetails.name);	// if orgname is changed push old name into altername_names
		if (ret.orgdomain != orgDetails.domain) if (!_array_includes_nocase(ret.orgdomains, orgDetails.domain)) 
			ret.orgdomains.push(orgDetails.domain);	// if orgdomain is changed push old domain into altername_domains

		let undeletableDomainFoundDeleted = [];	// make sure we are not dropping undeletable domains
		if (_arrayBNotSubsetOfA(ret.orgdomains, orgDetails.alternate_domains))	// some domains have been droppped
			for (const oldDomain of orgDetails.alternate_domains) if ( (!ret.orgdomains.includes(oldDomain))
				&& (!orgDetails.deletable_domains.includes(oldDomain)) ) undeletableDomainFoundDeleted.push(oldDomain);
		if (undeletableDomainFoundDeleted.length) {
			monkshu_env.components['dialog-box'].error("dialog", mustache_instance.render(
				await i18n.get("SomeUndeletableDomainsFound"), {domains: undeletableDomainFoundDeleted.join(", ")}));
			return;
		}

		if ((!dontCheckAutoUserMigrations) && _arrayBNotSubsetOfA(ret.orgnames, orgDetails.alternate_names)) {
			monkshu_env.components['dialog-box'].error("dialog", await i18n.get("ChangingSuborgsWillMigrateUsers"));
			dontCheckAutoUserMigrations = true;
			return;	// inform admin if he changes org alternate names we will migrate associated users
		}

		const req = {id: session.get(conf.userid_session_variable).toString(), 
			org: orgDetails.name, new_org: ret.orgname, primary_contact_name: ret.orgcontactname, 
			primary_contact_email: ret.orgcontactemail, address: ret.orgaddress||"", 
			domain: ret.orgdomain, alternate_names: ret.orgnames, alternate_domains: ret.orgdomains}; 
		const backendURL = user_manager.getHostElement(element).getAttribute("backendurl");
		const editResult = await _callBackendAPIShowingSpinner(`${backendURL}/${API_UPDATE_ORG}`, req, "POST", true, true);
		if (!(editResult?.result)) { 
			const key = !editResult ? "Internal" : editResult.reason == "internal" ? "Internal" : editResult.reason == "domainerror" ? "Domain" : "Internal";
			const err = await i18n.get(`OrgEditError${key}`); LOG.error(err); 
			monkshu_env.components['dialog-box'].error("dialog", err); 
		} else { 
			session.set(conf.userorg_session_variable, ret.orgname);	// update org name for the current user
			monkshu_env.components['dialog-box'].hideDialog("dialog"); 
			user_manager.reload(user_manager.getHostElementID(element)); 
		}
	});
}

async function editAPIKeys(org, usermanagerContainedElement) {
	const backendurl = user_manager.getHostElement(usermanagerContainedElement).getAttribute("backendurl");
	let orgkeyResult = await apiman.rest(`${backendurl}/${API_ORGKEYS}`, "POST", {type: "get", org}, true);
	if ((!orgkeyResult) || (!orgkeyResult.result) || (!orgkeyResult.keys?.length)) {
		LOG.error(`Org ${org} has no keys set or failed to fetch. Will create new ones.`)
		orgkeyResult = await apiman.rest(`${backendurl}/${API_ORGKEYS}`, "POST", {type: "set", org}, true);
	}
	if ((!orgkeyResult) || (!orgkeyResult.result) || (!orgkeyResult.keys?.length)) {	// set failed too, can't proceed
		const err = await i18n.get(`OrgKeySetError`); LOG.error(err); 
		_showError(err); return;
	}
	
	monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/editapikey.html`, true, false, 
		{org, CONF:conf, COMPONENT_PATH, apikey: orgkeyResult.keys[0], backendurl}, "dialog");
}

async function newAPIKey(textareaKey, org, backendurl) {
	const key = util.generateUUID(false)+util.generateUUID(false)+util.generateUUID(false);	// generate a random key
	const orgkeyResult = await apiman.rest(`${backendurl}/${API_ORGKEYS}`, "POST", {type: "set", org, keys: [key]}, true);
	if ((!orgkeyResult) || (!orgkeyResult.result)) {
		const err = await i18n.get(`OrgKeySetError`); LOG.error(err); 
		monkshu_env.components['dialog-box'].error("dialog", err); 
	} else textareaKey.value = orgkeyResult.keys[0];
}

async function _deleteUser(name, id, element) {
	const host = user_manager.getHostElement(element), logoutcommand = host.getAttribute("logoutcommand"), backendURL = host.getAttribute("backendurl");
	_execOnConfirm(mustache_instance.render(await i18n.get("ConfirmUserDelete"), {name, id}), async _ =>{
		const deleteResult = await apiman.rest(`${backendURL}/${API_DELETEUSER}`, "GET", 
			{name, userid: id, id: session.get(conf.userid_session_variable).toString(), 
				org: session.get(conf.userorg_session_variable).toString()}, true);
		if (!deleteResult?.result) {const err = mustache_instance.render(await i18n.get("DeleteError"), {name, id}); LOG.error(err); _showError(err);}
		else {
			if (id==session.get(conf.userid_session_variable).toString() && logoutcommand) eval(logoutcommand);	// user deleted themselves, logout!
			else user_manager.reload(user_manager.getHostElementID(element));	// reload user list
		}
	});
}

async function _resetUser(name, id, element) {
	_execOnConfirm(mustache_instance.render(await i18n.get("ConfirmUserReset"), {name, id}), async _ =>{
		const backendURL = user_manager.getHostElement(element).getAttribute("backendurl"), lang = i18n.getSessionLang();
		const resetResult = await apiman.rest(`${backendURL}/${API_RESETUSER}`, "GET", {id, lang}, true);
		if (!resetResult?.result) {const err = mustache_instance.render(await i18n.get("ResetError"), {name, id}); LOG.error(err); _showError(err);}
		else _showMessage(await i18n.get("ResetSuccess"));
	});
}

async function _approveUser(name, id, element) {
	const backendURL = user_manager.getHostElement(element).getAttribute("backendurl");
	const approveResult = await apiman.rest(`${backendURL}/${API_APPROVEUSER}`, "GET", {id, name,
		lang: i18n.getSessionLang(), org: session.get(conf.userorg_session_variable).toString()}, true);
	if (!approveResult?.result) {
		const err = mustache_instance.render(await i18n.get("ApproveError"), {name, id}); 
		LOG.error(err); _showError(err);
	} else { 
		await _showMessage(mustache_instance.render(await i18n.get("Approved"), {name, id})); 
		user_manager.reload(user_manager.getHostElementID(element)); 
	}
}

function _createData(host, users) {
	const data = {COMPONENT_PATH, CONTEXT_MENU_ID, org: session.get(conf.userorg_session_variable).toString(), 
		orgdomain: session.get(conf.userdomain_session_variable).toString()};

	if (host.getAttribute("styleBody")) data.styleBody = `<style>${host.getAttribute("styleBody")}</style>`;
	if (users) data.users = users;
	data.CONF = conf;

	return data;
}

const _callBackendAPIShowingSpinner = async (url, req, method="POST", sendToken=true, extractToken) => {
	const dialogShadowRoot = monkshu_env.components['dialog-box'].getShadowRootByHostId("dialog");
	dialogShadowRoot.querySelector("span#spinner").classList.add("visible");
	const result = await apiman.rest(url, method, req, sendToken, extractToken);
	dialogShadowRoot.querySelector("span#spinner").classList.remove("visible");
	return result;
}

const _showError = async error => { await monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/error.html`, 
	true, false, {error, CONF:conf}, "dialog", []); monkshu_env.components['dialog-box'].hideDialog("dialog"); }
const _showMessage = async message => { await monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/message.html`, 
	true, false, {message, CONF:conf}, "dialog", []); monkshu_env.components['dialog-box'].hideDialog("dialog"); }
const _execOnConfirm = (message, cb) => {
	if (cb) monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/message.html`, 
		true, true, {message, CONF:conf}, "dialog", [], _=>{monkshu_env.components['dialog-box'].hideDialog("dialog"); cb();});
	else return new Promise(resolve => monkshu_env.components['dialog-box'].showDialog(
		`${COMPONENT_PATH}/dialogs/message.html`, true, true, {message, CONF:conf}, "dialog", [],
		_=>{monkshu_env.components['dialog-box'].hideDialog("dialog"); resolve(true)}, _=>resolve(false)));
}

export const user_manager = {trueWebComponentMode: true, elementConnected, userMenuClicked, orgMenuClicked, addUser, 
	editUser, editOrg, searchModified, elementRendered, editAPIKeys, newAPIKey}
monkshu_component.register("user-manager", `${COMPONENT_PATH}/user-manager.html`, user_manager);