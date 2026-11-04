const tutorialDialog=document.getElementById('tutorial-dialog');
const tutorialFrame=document.getElementById('tutorial-frame');
const tutorialButton=document.getElementById('open-tutorial');
tutorialButton.addEventListener('click',()=>{if(tutorialDialog.open)return;tutorialFrame.src='/tutorial.html';tutorialDialog.showModal();document.getElementById('close-tutorial').focus();});
document.getElementById('close-tutorial').addEventListener('click',()=>tutorialDialog.close());
tutorialDialog.addEventListener('close',()=>{tutorialFrame.removeAttribute('src');tutorialButton.focus();});
tutorialFrame.addEventListener('load',()=>{if(!tutorialFrame.hasAttribute('src'))return;tutorialFrame.contentDocument?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();tutorialDialog.close();}});});
