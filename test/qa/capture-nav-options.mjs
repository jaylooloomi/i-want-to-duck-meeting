import {chromium} from 'playwright-core';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:1600,height:850},deviceScaleFactor:1.5});await page.goto(pathToFileURL(path.resolve('docs/design/sidebar-navigation-options/options.html')).href);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'docs/design/sidebar-navigation-options/options.png',fullPage:true});}finally{await browser.close();}
