import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const LANGUAGES=Object.freeze({
 'zh-TW':{caption:'cmn-Hant-TW',label:'中文',meet:['Chinese (Mandarin, Traditional)'],teams:['Chinese (Traditional, Taiwan)','Chinese (Taiwan)','中文（台灣）','中文 (台灣)','中文（臺灣）'],asr:'zh'},
 en:{caption:'en-US',label:'英文',meet:['English','English (United States)'],teams:['English (US)','English (United States)','英文（美國）'],asr:'en'},
 de:{caption:'de-DE',label:'德文',meet:['German','German (Germany)','Deutsch'],teams:['German (Germany)','German','德文（德國）','德語（德國）'],asr:'de'},
 ja:{caption:'ja-JP',label:'日文',meet:['Japanese','日本語'],teams:['Japanese (Japan)','Japanese','日文（日本）','日本語'],asr:'ja'},
 ko:{caption:'ko-KR',label:'韓文',meet:['Korean','한국어'],teams:['Korean (Korea)','Korean','韓文（韓國）','한국어'],asr:'ko'},
});
export const DEFAULT_PREFERENCES=Object.freeze({schemaVersion:1,spokenLanguage:'zh-TW',originalDisplay:'follow-meeting',translationLanguage:'en'});
export function canonicalLanguage(code){if(typeof code!=='string')return null;if(/^(?:zh|cmn)(?:-|$)/i.test(code))return 'zh-TW';return Object.keys(LANGUAGES).find(key=>key===code||key===code.split('-')[0])||null;}
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.keys(DEFAULT_PREFERENCES).includes(key))||value.schemaVersion!==1||!Object.hasOwn(LANGUAGES,value.spokenLanguage)||!['follow-meeting','all',...Object.keys(LANGUAGES)].includes(value.originalDisplay)||!['none','zh-TW','zh-CN','en','ja','de','fr','es','ko','it','pt','vi','th'].includes(value.translationLanguage))throw new Error('meeting_preferences_invalid');
 return {...value};
}
export function readMeetingPreferences(home){
 const file=path.join(home,'meeting-preferences.json');let raw;
 try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('invalid file');raw=fs.readFileSync(file,'utf8');const value=validate(JSON.parse(raw));return {preferences:value,revision:createHash('sha256').update(raw).digest('hex'),source:'saved'};}
 catch(error){if(error.code==='ENOENT')return {preferences:{...DEFAULT_PREFERENCES},revision:null,source:'built-in'};return {preferences:{...DEFAULT_PREFERENCES},revision:raw===undefined?null:createHash('sha256').update(raw).digest('hex'),source:'built-in',warning:'meeting_preferences_unreadable'};}
}
export function saveMeetingPreferences(home,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(input,'expectedRevision'))throw new Error('meeting_preferences_revision_required');
 const {expectedRevision,...value}=input;validate(value);fs.mkdirSync(home,{recursive:true});const lock=path.join(home,'meeting-preferences.lock');let fd;
 try{fd=fs.openSync(lock,'wx');}catch{throw new Error('meeting_preferences_busy');}
 const file=path.join(home,'meeting-preferences.json'),tmp=file+'.tmp';
 try{const old=readMeetingPreferences(home);if(old.revision!==expectedRevision)throw new Error('meeting_preferences_conflict');if(old.warning&&old.revision===null)throw new Error('meeting_preferences_unreadable');fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');fs.renameSync(tmp,file);return readMeetingPreferences(home);}
 finally{try{fs.unlinkSync(tmp);}catch{}fs.closeSync(fd);fs.unlinkSync(lock);}
}
export function resolveMeetingLanguage(config,explicit){
 const stored=readMeetingPreferences(config.home),requested=explicit||config.captionLang||LANGUAGES[stored.preferences.spokenLanguage].caption;
 const canonical=canonicalLanguage(requested),p=stored.preferences;
 return {...(stored.warning?{warning:stored.warning}:{}),schemaVersion:1,spokenLanguage:canonical||requested,captionLanguage:LANGUAGES[requested]?.caption||requested,originalDisplay:p.originalDisplay==='follow-meeting'?(canonical||'all'):p.originalDisplay,translationLanguage:p.translationLanguage,source:explicit?'request':config.captionLangSource||stored.source,revision:stored.revision,asrLanguage:canonical?LANGUAGES[canonical].asr:null};
}
