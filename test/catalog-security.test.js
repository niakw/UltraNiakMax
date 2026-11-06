"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {parseCatalogPath,parseCatalogExtra}=require("../services/catalog-route-service");
const {registerConfigRoutes}=require("../services/config-route-service");
const {hashPassword,verifyPassword}=require("../utils/auth");
test("catalog parser accepts safe Stremio routes",()=>{
 const generic=parseCatalogPath("/catalog/movie/trending_movies.json");
 assert.equal(generic.type,"movie");assert.equal(generic.id,"trending_movies");
 const cfg=parseCatalogPath("/c/ABCDEF12/catalog/series/new/skip=5.json");
 assert.equal(cfg.token,"ABCDEF12");assert.equal(cfg.extraStr,"skip=5");
 for(const route of ["/catalog/movie/__proto__.json",
  "/c/constructor/catalog/movie/top.json","/catalog/movie/"+"a".repeat(5000)+".json"])
  assert.equal(parseCatalogPath(route),null);
});
test("catalog extras cannot pollute Object.prototype",()=>{
 const a=parseCatalogExtra('{"__proto__":{"injected":true},"search":"one"}');
 assert.equal(a.search,"one");assert.equal(Object.prototype.injected,undefined);
 assert.equal(Object.hasOwn(a,"__proto__"),false);
 const b=parseCatalogExtra("skip=2&constructor=evil&search=title");
 assert.equal(b.search,"title");assert.equal(Object.hasOwn(b,"constructor"),false);
});
function setup() {
 const routes={};let writes=0;
 const token="ABCDEF12";
 const configs=Object.assign(Object.create(null),{[token]:{
  passwordHash:hashPassword("strong-password"),catalogs:["movie"]
 }});
 const app={post(path,...fns){routes["POST "+path]=fns.at(-1);},
  get(path,...fns){routes["GET "+path]=fns.at(-1);}};
 registerConfigRoutes(app,{loadConfigs:()=>configs,saveConfigs:()=>{writes++;},
  hashPassword,verifyPassword,generateToken:()=>"0123456789ABCDEF0123456789ABCDEF",
  rateLimit:()=>false});
 const res=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(data){this.body=data;return this;}});
 return {routes,configs,res,token,getWrites:()=>writes};
}
test("collection writes require password and reject pollution",()=>{
 const {routes,configs,res,token,getWrites}=setup();
 const fn=routes["POST /c/:token/collections"];
 const req={params:{token},body:{collections:[{title:"safe"}]},get:()=>undefined};
 assert.equal(fn(req,res()).code,401);
 req.body.password="strong-password";
 const passed=res();fn(req,passed);
 assert.equal(passed.code,200);assert.equal(configs[token].collections.length,1);
 assert.equal(getWrites(),1);
 const malicious={...req,body:{password:"strong-password",
  collections:JSON.parse('[{"title":"bad","__proto__":{"isAdmin":true}}]')}};
 assert.equal(fn(malicious,res()).code,400);
 assert.equal(Object.prototype.isAdmin,undefined);
 assert.equal(fn({...req,params:{token:"__proto__"}},res()).code,404);
});

test("public manifest token cannot read private provider keys",()=>{
 const {routes,res,token,configs}=setup();
 configs[token].mdblistKey="PRIVATE_KEY";
 const read=res();routes["GET /c/:token/config"]({params:{token}},read);
 assert.equal(read.code,200);assert.equal(read.body.mdblistKey,undefined);
 const privateRead=routes["POST /c/:token/config/auth"];
 const denied=res();privateRead({params:{token},body:{password:"incorrect"}},denied);
 assert.equal(denied.code,401);
 const authorized=res();privateRead({params:{token},body:{password:"strong-password"}},authorized);
 assert.equal(authorized.code,200);
 assert.equal(authorized.body.mdblistKey,"PRIVATE_KEY");
 assert.match(authorized.headers["Cache-Control"],/no-store/);
});

test("legacy SHA-256 profiles are upgraded to scrypt after valid login",()=>{
 const crypto=require("node:crypto");
 const {routes,res,token,configs,getWrites}=setup();
 const {strengthenLegacyPasswordHash}=require("../utils/auth");
 configs[token].passwordHash=strengthenLegacyPasswordHash(crypto.createHash("sha256")
   .update("strong-password"+"ultramax_salt").digest("hex"));
 assert.equal(verifyPassword("wrong",configs[token].passwordHash),false);
 assert.equal(verifyPassword("strong-password",configs[token].passwordHash),true);
 const r=res();
 routes["POST /c/:token/config/auth"]({
   params:{token},body:{password:"strong-password"}
 },r);
 assert.equal(r.code,200);
 assert.match(configs[token].passwordHash,/^scrypt:/);
 assert.equal(getWrites(),1);
 assert.equal(verifyPassword("strong-password",configs[token].passwordHash),true);
 assert.equal(verifyPassword("wrong",configs[token].passwordHash),false);
});
