'use strict';

const fs = require('fs');
const child_process= require('child_process');

exports.handler=(event, context, callback)=>{
    const bucketSource = 'mp3-bucket';
    const bucketDestination = 'democracy-live';
    console.log(`Processing audio(s) from bucket: ${bucketSource}`);
    getMp3FromS3(bucketSource).then((mp3Names) =>{
        processAudios(mp3Names, bucketDestination);
    });
};

function execCommand(cmd) {
    if (Array.isArray(cmd)) {
        cmd= cmd.join(' ');
    }
    return new Promise((resolve, reject) => {
        console.log('executing command:', cmd);
        child_process.exec(cmd, (error, stdout, stderr)=>{
            if(error) reject(error);
            resolve(stdout+stderr);
        })
    });
}
function getMp3FromS3(bucket) {
    const cmd = [`./cli/aws s3 cp s3://${bucket}/ /tmp --recursive`];
    return execCommand(cmd).then((response) => {
        //grab JSON str and make it into object
        let lines= response.split('\n');
        const mp3Names= [];
        lines.forEach(function(line, index) {
            if (line.includes('download')) {
                let start= line.search('tmp/');
                let name= line.slice(start+4, line.length);
                mp3Names.push(name.trim());
            }
        });
        if (mp3Names === []) {
          throw 'Unable to find name for MP3 in: '+response;
        }
        return mp3Names;
    }).catch((error)=>{
        throw `Error: ${error}`;
    });
}
function sendBackToS3(bucketDest) {
    const cmd = [`./cli/aws s3 cp /tmp s3://${bucketDest}/ --recursive --exclude "*" --include "*.mp3"`];
    return execCommand(cmd)
    .then((success)=>{
        console.log(`MP3 files has been added to ${bucketDest}`);
    }).catch((err)=>{
        throw err +" could not upload to s3.";
    });
}
function measureLoudness(mp3File) {
    const cmd = [`./ffmpeg -i /tmp/${mp3File}`];
    cmd.push(`-af loudnorm=I=-14:TP=-2:LRA=11:print_format=json -f null -`);
    return execCommand(cmd).then((response) => {
        //grab JSON str and make it into object
        let lines= response.split('\n');
        let start= -1;
        let end= -1;
        lines.forEach(function(line, index) {
            if (line==='{') {
                start= index;
            }else if (line==='}') {
                end= index;
            }
        });
        if (start === -1 || end === -1) {
          throw 'Unable to find JSON response in: '+response;
        }
        return JSON.parse(lines.slice(start, end+1).join(''));
    }).catch((error) => {
        throw `Error interpreting ${mp3File}. Make sure ffmpeg is in your path.`;
    });
}
function adjustForAlexa(file, I, TP, LRA, threshold, offset) {
  const cmd = [`./ffmpeg -i /tmp/${file}`];
  cmd.push(`-af loudnorm=I=-14:TP=-2:LRA=11:measured_I=${I}:measured_TP=${TP}:measured_LRA=${LRA}:measured_thresh=${threshold}:offset=${offset}:linear=true`);
  cmd.push('-codec:a libmp3lame'); // Format
  cmd.push('-ac 2'); // not sure...
  cmd.push('-b:a 48k'); // Bitrate
  cmd.push('-ar 16000'); // Sample rate
  cmd.push(`-y /tmp/output-${file}`);

  return execCommand(cmd).catch((err) => {
    throw 'Error converting: '+file;
  });
}
function processAudios(mp3Names, bucketDest) {
    const filesNormalized=[];
        mp3Names.forEach(function(file){
            let promise= new Promise((resolve,reject)=>{
                measureLoudness(file).then((data) => {
                  return adjustForAlexa(file, data.input_i, data.input_tp, data.input_lra, data.input_thresh, data.target_offset);
                }).then((success) => {
                  console.log(file + ' processed.');
                  resolve('done reading');
                }).catch((err) => {
                  console.error(err);
                });
            });
            filesNormalized.push(promise);
        });
        Promise.all(filesNormalized).then(result=>{
            console.log('last step');
            return sendBackToS3(bucketDest);
        });
}
