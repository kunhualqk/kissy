/**
 * @ignore
 * mix loader into S and infer KISSY baseUrl if not set
 * @author yiminghe@gmail.com
 */
(function (S, undefined) {

    var Loader = KISSY.Loader,
        Env = S.Env,
        Utils = Loader.Utils,
        SimpleLoader = Loader.SimpleLoader,
        ComboLoader = Loader.ComboLoader;

    function WaitingModules(fn) {
        S.mix(this, {
            fn: fn,
            waitMods: {}
        });
    }

    WaitingModules.prototype = {

        constructor: WaitingModules,

        notifyAll: function () {
            var self = this,
                fn = self.fn;
            if (fn && S.isEmptyObject(self.waitMods)) {
                self.fn = null;
                fn();
            }
        },

        add: function (modName) {
            this.waitMods[modName] = 1;
        },

        remove: function (modName) {
            delete this.waitMods[modName];
        },

        contains: function (modName) {
            return this.waitMods[modName];
        }

    };

    Loader.WaitingModules = WaitingModules;

    S.mix(S, {
        /**
         * Registers a module with the KISSY global.
         * @param {String} name module name.
         * it must be set if combine is true in {@link KISSY#config}
         * @param {Function} fn module definition function that is used to return
         * this module value
         * @param {KISSY} fn.S KISSY global instance
         * @param {Object} [cfg] module optional config data
         * @param {String[]} cfg.requires this module's required module name list
         * @member KISSY
         *
         * for example:
         *      @example
         *      // dom module's definition
         *      KISSY.add('dom', function(S, xx){
             *          return {css: function(el, name, val){}};
             *      },{
             *          requires:['xx']
             *      });
         */
        add: function (name, fn, cfg) {
            if (typeof name == 'string') {
                Utils.registerModule(S, name, fn, cfg);
            } else {
                SimpleLoader.add(name, fn, cfg, S);
            }
        },
        /**
         * Attached one or more modules to global KISSY instance.
         * @param {String|String[]} modNames moduleNames. 1-n modules to bind(use comma to separate)
         * @param {Function} success callback function executed
         * when KISSY has the required functionality.
         * @param {KISSY} success.S KISSY instance
         * @param success.x... used module values
         * @member KISSY
         *
         * for example:
         *      @example
         *      // loads and attached overlay,dd and its dependencies
         *      KISSY.use('overlay,dd', function(S, Overlay){});
         */
        use: function (modNames, success) {
            var Config = S.Config,
                normalizedModNames,
                loader,
                error,
                sync,
                waitingModules = new WaitingModules(loadReady);

            if (S.isPlainObject(success)) {
                sync = success.sync;
                error = success.error;
                success = success.success;
            }

            modNames = Utils.getModNamesAsArray(modNames);
            modNames = Utils.normalizeModNamesWithAlias(S, modNames);

            normalizedModNames = Utils.unalias(S, modNames);

            function loadReady() {
                var errorList = [],
                    ret;
                ret = Utils.attachModsRecursively(normalizedModNames, S, undefined, errorList);
                if (ret) {
                    if (success) {
                        if (sync) {
                            success.apply(S, Utils.getModules(S, modNames));
                        } else {
                            // standalone error trace
                            setTimeout(function () {
                                success.apply(S, Utils.getModules(S, modNames));
                            }, 0);
                        }
                    }
                } else if (errorList.length) {
                    if (error) {
                        if (sync) {
                            error.apply(S, errorList);
                        } else {
                            setTimeout(function () {
                                error.apply(S, errorList);
                            }, 0);
                        }
                    }
                } else {
                    waitingModules.fn = loadReady;
                    loader.use(normalizedModNames);
                }
            }

            if (Config.combine && !S.UA.nodejs) {
                loader = new ComboLoader(S, waitingModules);
            } else {
                loader = new SimpleLoader(S, waitingModules);
            }

            // in case modules is loaded statically
            // synchronous check
            // but always async for loader
            if (sync) {
                waitingModules.notifyAll();
            } else {
                setTimeout(function () {
                    waitingModules.notifyAll();
                }, 0);
            }
            return S;
        },

        require: function (name) {
            return Utils.getModules(S,
                Utils.normalizeModNamesWithAlias(S, [name]))[1];
        }
    });

    function returnJson(s) {
        return (new Function('return ' + s))();
    }

    var baseReg = /^(.*)(seed|kissy)(?:-min)?\.js[^/]*/i,
        baseTestReg = /(seed|kissy)(?:-min)?\.js/i;

    function getBaseInfoFromOneScript(script) {
        // can not use KISSY.Uri
        // /??x.js,dom.js for tbcdn
        var src = script.src || '';
        if (!src.match(baseTestReg)) {
            return 0;
        }

        var baseInfo = script.getAttribute('data-config');

        if (baseInfo) {
            baseInfo = returnJson(baseInfo);
        } else {
            baseInfo = {};
        }

        var comboPrefix = baseInfo.comboPrefix = baseInfo.comboPrefix || '??';
        var comboSep = baseInfo.comboSep = baseInfo.comboSep || ',';

        var parts ,
            base,
            index = src.indexOf(comboPrefix);

        // no combo
        if (index == -1) {
            base = src.replace(baseReg, '$1');
        } else {
            base = src.substring(0, index);
            // a.tbcdn.cn??y.js, ie does not insert / after host
            // a.tbcdn.cn/combo? comboPrefix=/combo?
            if (base.charAt(base.length - 1) != '/') {
                base += '/';
            }
            parts = src.substring(index + comboPrefix.length).split(comboSep);
            S.each(parts, function (part) {
                if (part.match(baseTestReg)) {
                    base += part.replace(baseReg, '$1');
                    return false;
                }
                return undefined;
            });
        }

        return S.mix({
            base: base
        }, baseInfo);
    }

    /**
     * get base from seed.js
     * @return {Object} base for kissy
     * @ignore
     *
     * for example:
     *      @example
     *      http://a.tbcdn.cn/??s/kissy/x.y.z/seed-min.js,p/global/global.js
     *      note about custom combo rules, such as yui3:
     *      combo-prefix='combo?' combo-sep='&'
     */
    function getBaseInfo() {
        // get base from current script file path
        // notice: timestamp
        var scripts = Env.host.document.getElementsByTagName('script'),
            i,
            info;

        for (i = scripts.length - 1; i >= 0; i--) {
            if (info = getBaseInfoFromOneScript(scripts[i])) {
                return info;
            }
        }

        S.error('must load kissy by file name: seed.js or seed-min.js');
        return null;
    }

    if (S.UA.nodejs) {
        // nodejs: no tag
        S.config({
            charset: 'utf-8',
            base: __dirname.replace(/\\/g, '/').replace(/\/$/, '') + '/'
        });
    } else {
        // will transform base to absolute path
        S.config(S.mix({
            // 2k(2048) url length
            comboMaxUrlLength: 2000,
            // file limit number for a single combo url
            comboMaxFileNum: 40,
            charset: 'utf-8',
            tag: '@TIMESTAMP@'
        }, getBaseInfo()));
    }

    // Initializes loader.
    Env.mods = {}; // all added mods

})(KISSY);

/*
 2013-06-04 yiminghe@gmail.com
 - refactor merge combo loader and simple loader
 - support error callback
 */

/**
 * @ignore
 * KISSY Loader
 * @author qingkun.liao@tmall.com
 */
(function (S, undefined) {
	function Loader(config){
		var self=this,
			defList=[],
			loaderMap={},
			syncMap=(config && config.syncMap)||{};//����߼��Ҿ��ò�Ӧ��֧�֣����е��߼���Ӧ����ͬ����
		/**
		 *��ȡ������
		 *@param {String} name ģ������
		 *@returns {Function} ������
		 */
		self.get=function(name){
			if(loaderMap[name]){return loaderMap[name];}
			for(var i=defList.length-1;i>=0;i--)
			{
				var loadDef=defList[i],filter;
				if(!(filter=loadDef.filter) || filter===name || (filter.test && filter.test(name) || filter(name)))
				{
					return loaderMap[name]=Loader.create(loadDef.creater(name));
				}
			}
		}
		/**
		 *������ط���
		 *@param {Object} loadDef ���ط����������
		 *@param {Function} loadDef.creater ����ģ�����ƻ�ȡģ����ط����ĺ���
		 *@param {String|RegExp|Function} [loadDef.filter] ģ����ɸѡ��������ָ��ɸѡ����ģ��Ż�ʹ�ô˼��ط���
		 *@param {Number} [loadDef.order=0] �˶�������ȵȼ�,����Խ��Խ����
		 */
		self.define=function(loadDef)
		{
			defList.push(loadDef);
			defList.sort(function(a,b){return (a.order||0)-(b.order||0)});
		}
		self.use=function(names, callback)
		{
			if(!names){return;}
			if(names.split){names=names.split(",");}
			var len=names.length,
				type= 1,
				sync= false,
				error,
				loaders=[];
			if(callback && !callback.apply)
			{
				error=callback.error;
				if(callback.type!==undefined){type=callback.type;}
				if(callback.sync!==undefined){sync=callback.sync;}
				callback.sync
				callback=callback.success;
			}

			for(var i=0;i<len;i++)
			{
				if(sync){syncMap[names[i]]=sync;}
				loaders.push(self.get(names[i]));
			}
			Loader.bulkLoad(loaders,function(mods){
				var errorList=[];
				for(var i=mods.length-1;i>=0;i--)
				{
					if(mods[i]===undefined)//ʵ���ϼ���ʧ��
					{
						errorList.push({name:names[i],status:3});
					}
				}
				if(errorList.length)
				{
					error && error.apply(S, errorList);
				}
				else
				{
					callback && callback.apply(S,[S].concat(mods));
				}
			},type);
		}
	}
	/**
	 *���ݼ��ط���ʵ�ּ�����
	 *@param {Function} load ���ط���
	 *@returns {Function} ������
	 */
	Loader.create=function(load)
	{
		var value,loading,handles=[],h;
		return function(handle,type)
		{
			//typeĬ��Ϊ1
			//0:	���������أ������������֮��ִ�лص�����
			//1:	�������أ��������֮��ִ�лص�����
			//2:	���������أ�ֻ�ڵ�ǰ�Ѿ����ڵ������ִ�лص�����
			if(type!==0 && !type){type=1;}
			if((type&1) && !loading)
			{
				loading=true;
				load(function(v){
					value=v;
					while(h=handles.shift())
					{
						h && h(value);
					}
				})
			}
			if(value){handle && handle(value);return ;}
			if(!(type&2)){handle && handles.push(handle);}//���ֻ�ڴ��ڵ�����»ص������˳�
		}
	}
	/**
	 *��������
	 *@param {Array} loaders ����������
	 *@param {Function} callback ȫ��������ɺ�Ļص����ص������Ǽ��ؽ������
	 *@param {Number} [type] ȫ��������ɺ�Ļص����ص������Ǽ��ؽ������
	 */
	Loader.bulkLoad=function(loaders,callback,type)
	{
		if(!loaders || !loaders.length){
			callback && callback();
			return;
		}
		var len=loaders.length,
			count= 0,
			argu=new Array(len);
		function getCallback(ind){
			return function(value){
				argu[ind]=value;
				if((++count)==len)
				{
					callback && callback(argu);
				}
			}
		}
		for(var i=0;i<len;i++)
		{
			loaders[i](getCallback(i),type);
		}
	}

	function AddLoader()
	{
		var self=this,
			requireMap={},
			routerMap={};
		self.findCyclicDependency=function(stack,name)
		{
			for(var i=stack.length-1;i>=0;i--)
			{
				if(stack[i]==name){return stack.concat(name);}
			}
			var requires=requireMap[name],result;
			if(requires){
				for(var j=requires.length-1;j>=0;j--)
				{
					if(result=findCyclicDependency(stack.concat(name),requires[j]))
					{
						return result;
					}
				}
			}
		}
		self.addDependency=function(name,requires)
		{
			if(!requires || !requires.length){return;}
			requireMap[name]=requires;
			//����Ĵ�����ʵ������Ĵ�����Լ�ʵ�֣�Ϊ�˲����Ĳ�����������ʱ����
			var result;
			for(var i=requires.length- 1,r;i>=0;i--)
			{
				if(r=findCyclicDependency([],requires[i]))
				{
					result=r;
					break;
				}
			}
			//var result=findCyclicDependency([],name);
			if(result)
			{
				S.error('find cyclic dependency between mods: ' + result);
				return false;
			}
			return true;
		}
		self.removeDependency=function(name)
		{
			delete requireMap[name];
		}
	}

	function clear(){
		var addSyncMap={},
			loader=new Loader({syncMap:addSyncMap});
		S.use=function()
		{
			loader.use.apply(loader,arguments);
		}
		S.clearLoader=clear;
	}
	S.require=function(name)
	{
		var mod;
		S.use(name,{
			success:function(S,m){
				mod=m;
			},
			type:2
		});
		return mod;
	}
	clear();

	var onNameCallback,startLoadModName;
	function createNormalizeModNameLoader(mod,refMod){
		return createLoader(function(callback){
			if(/^\.+\//.test(mod))
			{//��Ҫ�������·���л�
				S.use("path",function(S,Path){
					callback(Path.resolve(Path.dirname(refMod), mod));
				});
				return;
			}
			callback(mod);
		})

	}
	function getAddRouter(name)
	{
		if(addRouterMap[name]){return addRouterMap[name];}
		var addCallback,
			setter=function(value){
				addCallback(value);
			},
			gl=createLoader(function(callback){
				addCallback=callback;
			});
		gl();//����ִ�У���addCallback������ֵ���ú�
		return addRouterMap[name]={
			load:createLoader(function(callback){
				gl(function(argu){
					var getter=argu[0],
						config=argu[1]||{};
					function init(){
						var requires=config.requires;
						if(requires && requires.length)
						{
							var loaders=[];
							for(var i=0;i<requires.length;i++)
							{
								loaders.push(createNormalizeModNameLoader(requires[i],name));
							}
							Loader.bulkLoad(loaders,function(requires){
								//��Ҫ����ѭ������
								if(!addDependency(name,requires)){
									callback();
								}
								S.use(requires,{
									success:function(){
										removeDependency(name);
										var value=getter.apply(null,arguments);
										callback(value===undefined?null:value);
										//��ʵ���ʱ��ԭ������undefined
										//����undefined��loader֮�������⺬�壬��˸�Ϊnull,��Ҫȷ�����������
									},
									error:function(){
										callback();
									}
								});
							});
						}
						else
						{
							var value=getter();
							callback(value===undefined?null:value);
						}
					}
					addSyncMap[name]?init():setTimeout(init,0);
				});
			}),
			set:setter
		}
	}
	//��ȡ��ǰ��ģ������
	function onName(callback)
	{
		if (S.UA.ie) {
			// ie ���У��ҵ���ǰ���ڽ����Ľű������ݽű���ȷ��ģ����
			// ����Ҳ��������ط���ǰ�Ǹ��ű�
			var scripts = S.Env.host.document.getElementsByTagName('script'),
				re,
				i,
				name,
				script;

			for (i = scripts.length - 1; i >= 0; i--) {
				script = scripts[i];
				if (script.readyState == 'interactive') {
					re = script;
					break;
				}
			}
			if (re) {
				name = re.getAttribute('data-mod-name');
			} else {
				// sometimes when read module file from cache,
				// interactive status is not triggered
				// module code is executed right after inserting into dom
				// i has to preserve module name before insert module script into dom,
				// then get it back here
				// S.log('can not find interactive script,time diff : ' + (+new Date() - self.__startLoadTime), 'error');
				// S.log('old_ie get mod name from cache : ' + self.__startLoadModName);
				name = startLoadModName;
			}
			startLoadModName=null;
			callback(name);
		} else {
			onNameCallback=callback;
		}
	}
	S.add=function(name,getter,config){
		if(S.isFunction(name))
		{
			onName(function(realName)
			{
				S.add(realName,name,getter);
			});
			return;
		}
		getAddRouter(name).set([getter,config]);
	}

})(KISSY);