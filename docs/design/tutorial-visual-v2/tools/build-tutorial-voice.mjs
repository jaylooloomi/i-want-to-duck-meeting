import {spawnSync} from 'node:child_process';
const python=process.env.OPENMEETING_TTS_PYTHON||'.venv-stt/Scripts/python.exe';
const result=spawnSync(python,['docs/design/tutorial-visual-v2/tools/build-natural-voice.py'],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
