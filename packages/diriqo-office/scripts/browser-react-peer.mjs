/**
 * Adapt bundled CommonJS consumers to the host's static ESM React peer.
 * No React implementation, global require polyfill or second React copy is bundled.
 */
const NAMESPACE='diriqo-cjs-react-peer';
export function browserReactPeerPlugin(){
 return {
  name:'diriqo-browser-react-peer',
  setup(build){
   if(build.initialOptions.platform!=='browser'||build.initialOptions.format!=='esm')
    throw new Error('React peer bridge is only for the browser ESM package build.');
   build.onResolve({filter:/^react$/},args=>{
    if(args.kind==='require-call')return {path:'react',namespace:NAMESPACE};
    // Includes the bridge's re-export: resolve back to the host peer, never recurse.
    return {path:'react',external:true};
   });
   build.onLoad({filter:/^react$/,namespace:NAMESPACE},()=>({
    // CJS consumers require named React properties, so default-only is insufficient.
    // esbuild provides an internal namespace for require() of this known ESM module.
    contents:'export * from "react"; export { default } from "react";',
    loader:'js'
   }));
  }
 };
}
/** New external CJS edges require explicit review instead of a runtime browser crash. */
export function assertBrowserEsmPeerEdges(metafile){
 if(!metafile?.outputs)throw new Error('Browser ESM metadata is required.');
 const unsupported=[];
 for(const [output,info] of Object.entries(metafile.outputs))
  for(const edge of info.imports??[])
   if(edge.external&&edge.kind==='require-call')unsupported.push(output+' -> '+edge.path);
 if(unsupported.length)throw new Error('Browser ESM contains unsupported external require-call: '+unsupported.join(', '));
}
