"""Run inside the sandbox VM. Talks only to the two dedicated QA containers."""
import json, subprocess, time, os
RUN = os.environ.get("FEDERATION_QA_RUN", "run4")
if not RUN.replace("-", "").isalnum():
    raise ValueError("Invalid QA run name")
CLIENT = '''let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',async()=>{try{const r=await fetch('http://127.0.0.1:8080/',{method:'POST',headers:{'Content-Type':'application/json'},body:s});console.log(JSON.stringify(await r.json()))}catch{console.log(JSON.stringify({ok:false,error:'QA transport unavailable'}))}});'''
def call(node, action, **args):
    p=subprocess.run(['docker','exec','-i','travstats-federation-40-'+node+'-'+RUN,'node','-e',CLIENT], input=json.dumps({'action':action,**args}),capture_output=True,text=True,timeout=300)
    if p.returncode: raise RuntimeError('QA container command failed')
    return json.loads(p.stdout)
def ok(node, action, **args):
    r=call(node,action,**args)
    if not r['ok']: raise AssertionError(action+': '+r.get('error','refused'))
    return r['result']
def refused(node,action,**args):
    r=call(node,action,**args)
    assert not r['ok'], action+' unexpectedly accepted'
def passed(name, **evidence):
    print(json.dumps({'test':name,'status':'PASS',**evidence}),flush=True)
a=ok('alpha','info'); b=ok('beta','info')
ok('alpha','peer',origin=b['origin'],publicKey=b['publicKey']); ok('beta','peer',origin=a['origin'],publicKey=a['publicKey'])
assert ok('alpha','ping',origin=b['origin']) == {'ready':True}
assert ok('beta','ping',origin=a['origin']) == {'ready':True}
passed('two isolated databases, real DNS + HTTPS + signed bidirectional peer exchange')
assert ok('alpha','replay',origin=b['origin']) == {'first':200,'second':403,'tampered':403}
passed('replayed nonce and altered signature refused')
assert ok('alpha','wrong-pin',origin=b['origin']) == {'refused':True}
passed('wrong pinned server signing key refused')
ok('alpha','peer',origin='https://wrong.federation.test',publicKey=b['publicKey'])
refused('alpha','ping',origin='https://wrong.federation.test')
passed('trusted CA with wrong TLS hostname refused')
inv=ok('alpha','invite'); ok('beta','claim',invite=inv); ok('alpha','confirm'); ok('beta','confirm')
assert ok('alpha','devices')[0]['fingerprint']==b['device']['fingerprint']
assert ok('beta','devices')[0]['fingerprint']==a['device']['fingerprint']
passed('cross-server invitation, mutual confirmation and device discovery')
refused('alpha','legacy',origin=b['origin'])
passed('legacy plaintext peer read refused')
ok('alpha','publish',chunks=2,incomplete=True)
assert ok('beta','read',pinnedSender=a['device']['fingerprint']) is None
passed('interrupted publication invisible to remote recipient')
start=time.monotonic(); publication=ok('alpha','publish',chunks=128)
received=ok('beta','read',pinnedSender=a['device']['fingerprint'])
assert received['sha256']==publication['sha256'] and received['size']==publication['size']
passed('32 MiB encrypted transfer, duplicate chunk retry, SHA256 equality',bytes=received['size'],seconds=round(time.monotonic()-start,2))
refused('beta','read',pinnedSender='0'*64)
passed('unverified sender fingerprint refused')
ok('alpha','unavailable',value=True)
try: refused('beta','read',pinnedSender=a['device']['fingerprint'])
finally: ok('alpha','unavailable',value=False)
assert ok('beta','read',pinnedSender=a['device']['fingerprint'])['sha256']==publication['sha256']
passed('peer outage fails closed; existing encrypted publication remains readable after recovery')
ok('alpha','revoke-grant'); refused('beta','read',pinnedSender=a['device']['fingerprint'])
passed('source grant revocation blocks remote retrieval')
ok('alpha','publish',chunks=1); ok('alpha','revoke-device')
assert ok('beta','devices')==[]
assert ok('beta','read',pinnedSender=a['device']['fingerprint']) is None
new=ok('alpha','new-device')['device']; assert new['fingerprint']!=a['device']['fingerprint']
pub=ok('alpha','publish',chunks=1); refused('beta','read',pinnedSender=a['device']['fingerprint'])
assert ok('beta','read',pinnedSender=new['fingerprint'])['sha256']==pub['sha256']
passed('revoked sender packages removed; replacement device requires new independent fingerprint')
ok('beta','peer',origin=a['origin'],publicKey=a['publicKey'],enabled=False)
refused('beta','ping',origin=a['origin'])
passed('disabled peer refused')
print('FEDERATION_SANDBOX_ALL_PASS',flush=True)
