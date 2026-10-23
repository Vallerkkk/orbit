import test from 'node:test';import assert from 'node:assert/strict';
const {chatMedia,mediaToken}=await import('../static/chat-media.js');
test('marcador de GIF/figurinha só aceita a CDN do GIPHY',()=>{
  assert.deepEqual(chatMedia('[gif:oi](https://media1.giphy.com/media/a/200.webp)'),{kind:'gif',title:'oi',url:'https://media1.giphy.com/media/a/200.webp'});
  assert.equal(chatMedia('[figurinha](https://media.giphy.com/media/b/200.gif)').kind,'sticker');
  assert.equal(chatMedia('[gif](https://evil.example/a.gif)'),null);
  assert.equal(chatMedia('[gif](javascript:alert(1))'),null);
  assert.equal(chatMedia('olha [gif](https://media.giphy.com/media/a/1.gif)'),null);
  assert.equal(mediaToken('gif',{title:'a]b(c)',url:'https://media.giphy.com/media/a/1.gif'}),'[gif:a b c](https://media.giphy.com/media/a/1.gif)');
});
