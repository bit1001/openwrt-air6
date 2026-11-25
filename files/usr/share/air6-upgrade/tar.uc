'use strict';
import {readfile,writefile,stat,popen,open} from 'fs';
function run(args) {
 let p=popen(join(' ',map(args,v=>"'"+replace(''+v,"'","'\\''")+"'"))+' 2>&1','r');
 let out=p.read('all');if(p.close())die(out||'Command failed');return trim(out);
}
function digest(path){return split(run(['sha256sum',path]),' ')[0];}
function part(label){
 let hits=[];
 for(let n=1;n<=50;n++)if(index(readfile('/sys/class/block/mmcblk0p'+n+'/uevent')||'','PARTNAME='+label+'\n')>=0)push(hits,'/dev/mmcblk0p'+n);
 if(length(hits)!=1)die('Missing/duplicate partition '+label);return hits[0];
}
const roles={'boot.img':['boot',33554432],'rootfs.img':['rootfs',134217728],'modem.img':['md1img',83886080],'dsp.img':['md1dsp',10485760]};
function validate(path){
 if(trim(readfile('/tmp/sysinfo/board_name')||'')!='softbank,air6')die('Not AIR6');
 let slot=match(readfile('/proc/cmdline')||'',/(^|[ \t])bootslot=([ab])([ \t]|$)/)?.[2];
 if(!slot)die('Unknown running slot');
 if(!stat(path)||stat(path).size>280000000)die('Invalid archive size');
 let names=split(run(['tar','-tf',path]),'\n');
 let listing=split(run(['tar','-tvf',path]),'\n');
 if(!length(names)||length(names)>4||length(listing)!=length(names))die('Expected one to four regular partition images');
 let seen={},images=[];
 for(let i=0;i<length(names);i++){
  let name=names[i];
  if(!roles[name]||seen[name]||substr(listing[i],0,1)!='-')die('Unexpected, duplicate or nonregular tar entry: '+name);
  seen[name]=true;
  let target=part(roles[name][0]+'_'+slot);
  let size=+trim(readfile('/sys/class/block/'+substr(target,5)+'/size')||'0')*512;
  let rootfs = name == 'rootfs.img';
  if (size != roles[name][1] && !(rootfs && size == 536870912))
   die('Unexpected GPT partition size: ' + name + ' (' + size + ' bytes)');
  let length=+run(['sh','-c',"tar -xOf '"+replace(path,"'","'\\''")+"' "+name+' | wc -c']);
  if(!length||length>size||length%4)die('Invalid image size: '+name);
  let q=popen("tar -xOf '"+replace(path,"'","'\\''")+"' "+name+' | { head -c '+(name=='boot.img'?8:4)+'; cat >/dev/null; }','r');let magic=q.read('all');q.close();
  let wanted=name=='boot.img'?'ANDROID!':name=='rootfs.img'?'hsqs':chr(0x88)+chr(0x16)+chr(0x88)+chr(0x58);
  if(magic!=wanted)die('Invalid image header: '+name);
  push(images,{file:name,target:target,partition_size:size,size:length});
 }
 return {slot:slot,archive_sha256:digest(path),images:images};
}
const mode=ARGV[0],path=ARGV[1];
try {
 let plan=validate(path);
 if(mode=='check'){print(sprintf('%J',plan));exit(0);}
 if(mode!='flash')die('Unknown operation');
 if(index(readfile('/proc/mounts')||'',' /overlay ')>=0||index(readfile('/proc/mounts')||'',' /rom ')>=0)die('Detached RAM root required');
 let saved=json(readfile('/tmp/air6-tar-plan.json')||'null');
 if(!saved||saved.archive_sha256!=plan.archive_sha256||saved.slot!=plan.slot)die('Archive or slot changed since validation');
 run(['mkdir','/tmp/air6-tar-flash']);
 // Extract every image before writing any block device.
 for(let image in plan.images){
  run(['sh','-c','tar -xOf '+"'"+replace(path,"'","'\\''")+"'"+' '+image.file+' > /tmp/air6-tar-flash/'+image.file]);
  let local='/tmp/air6-tar-flash/'+image.file;
  image.size=stat(local)?.size;
  if(!image.size||image.size>image.partition_size||image.size%4)die('Image size invalid: '+image.file);
  let f=open(local,'r'),magic=f.read(image.file=='boot.img'?8:4);f.close();
  if(image.file=='rootfs.img' && magic!='hsqs')die('rootfs is not squashfs');
  if(image.file=='boot.img' && magic!='ANDROID!')die('Invalid Android boot image');
  if(image.file!='rootfs.img' && image.file!='boot.img' && magic!=chr(0x88)+chr(0x16)+chr(0x88)+chr(0x58))die('Missing MTK signed image header');
  // Build a whole-partition digest without allocating the zero-filled tail in RAM.
  let block = 1048576;
  image.blocks = (image.size + block - 1) >> 20;
  image.tail_blocks = (image.partition_size >> 20) - image.blocks;
  let aligned = image.blocks * block;
  if (image.size < aligned)
   run(['dd','if=/dev/zero','of='+local,'bs=1','seek='+(aligned-1),'count=1','conv=notrunc']);
  let zeroes = 'dd if=/dev/zero bs=1048576 count='+image.tail_blocks+' 2>/dev/null';
  image.sha256 = image.tail_blocks
   ? split(run(['sh','-c','set -o pipefail; { cat '+local+' && '+zeroes+'; } | sha256sum']),' ')[0]
   : digest(local);
 }
 for(let image in plan.images){
  run(['dd','if=/tmp/air6-tar-flash/'+image.file,'of='+image.target,'bs=1048576','conv=fsync']);
  if (image.tail_blocks)
   run(['dd','if=/dev/zero','of='+image.target,'bs=1048576','seek='+image.blocks,
        'count='+image.tail_blocks,'conv=notrunc,fsync']);
  if(digest(image.target)!=image.sha256)die('Partition readback failed: '+image.file);
 }
 run(['sync']);print('AIR6: selected partitions verified');
} catch(e){warn('AIR6 upgrade: '+e+'\n');exit(1);}
