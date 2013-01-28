/*
 * grunt-typescript
 * Copyright 2012 Kazuhide Maruyama
 * Licensed under the MIT license.
 */

module.exports = function (grunt) {
    // TODO: ditch this when grunt v0.4 is released
    grunt.util = grunt.util || grunt.utils;

    var path = require('path'),
        fs = require('fs'),
        vm = require('vm'),
        gruntIO = function (currentPath, destPath, basePath, compSetting) {
            var createdFiles = [];
            basePath = basePath || ".";

            return {
                getCreatedFiles: function(){
                    return createdFiles;
                },

                resolvePath: path.resolve,
                readFile: grunt.file.read,
                dirName: path.dirname,

                createFile:function (writeFile, useUTF8) {
                    var source = "";

                    return {
                        Write:function (str) {
                            source += str;
                        },
                        WriteLine:function (str) {
                            source += str + grunt.util.linefeed;
                        },
                        Close:function () {

                            if (source.trim().length < 1) {
                                return;
                            }
                            if(compSetting.outputMany){
                                var g = path.join(currentPath, basePath);
                                writeFile = writeFile.substr(g.length);
                                writeFile = path.join(currentPath, destPath, writeFile);
                            }

                            grunt.file.write(writeFile, source);
                            createdFiles.push(writeFile);
                        }
                    }
                },
                findFile: function (rootPath, partialFilePath) {

                    var file = path.join(rootPath, partialFilePath);
                    while(true) {
                        if(fs.existsSync(file)) {
                            try  {
                                var content = grunt.file.read(file);
                                return {
                                    content: content,
                                    path: file
                                };
                            } catch (err) {
                            }
                        } else {
                            var parentPath = path.resolve(rootPath, "..");
                            if(rootPath === parentPath) {
                                return null;
                            } else {
                                rootPath = parentPath;
                                file = path.resolve(rootPath, partialFilePath);
                            }
                        }
                    }
                },
                stderr:  {
                    Write: function (str) {
                        grunt.fail.warn(str);
                    },
                    WriteLine: function (str) {
                        grunt.fail.warn(str + '\n');
                    },
                    Close: function () {
                    }
                }
            }
        },
        resolveTypeScriptBinPath = function(currentPath, depth){
            var targetPath = path.resolve(__dirname,
                (new Array(depth + 1)).join("../../"),
                "../node_modules/typescript/bin");
            if(path.resolve(currentPath, "node_modules/typescript/bin").length > targetPath.length){
                return;
            }
            if(fs.existsSync(path.resolve(targetPath, "typescript.js"))){
                return targetPath;
            }

            return resolveTypeScriptBinPath(currentPath, ++depth);
        };

    grunt.registerMultiTask('typescript', 'Compile TypeScript files', function () {
        var helpers = require('grunt-lib-contrib').init(grunt);
        var that = this;

        this.files.forEach(function(f) {
            var dest = f.dest,
                options = helpers.options(that, {}),
                extension = that.data.extension,
                files = [];

            grunt.file.expand(f.src).forEach(function (filepath) {
                if (filepath.substr(-5) === ".d.ts") {
                    return;
                }
                files.push(filepath);
            });

            compile(files, dest, grunt.util._.clone(options), extension);

            if (grunt.task.current.errorCount) {
                return false;
            }
        });
    });

    var compile = function (srces, destPath, options, extension) {
        var currentPath = path.resolve("."),
            basePath = options.base_path,
            typeScriptBinPath = resolveTypeScriptBinPath(currentPath, 0),
            typeScriptPath = path.resolve(typeScriptBinPath, "typescript.js"),
            libDPath = path.resolve(typeScriptBinPath, "lib.d.ts");

        if(!typeScriptBinPath){
            grunt.fail.warn("typescript.js not found. please 'npm install typescript'.");
            return false;
        }
        var code = grunt.file.read(typeScriptPath);
        vm.runInThisContext(code, typeScriptPath);

        var setting = new TypeScript.CompilationSettings();
        var io = gruntIO(currentPath, destPath, basePath, setting);
        var env = new TypeScript.CompilationEnvironment(setting, io);
        var resolver = new TypeScript.CodeResolver(env);

        if (options) {
            if (options.target) {
                var target = options.target.toLowerCase();
                if (target === 'es3') {
                    setting.codeGenTarget = TypeScript.CodeGenTarget.ES3;
                } else if (target == 'es5') {
                    setting.codeGenTarget = TypeScript.CodeGenTarget.ES5;
                }
            }
            if (options.style) {
                setting.setStyleOptions(options.style);
            }
            if (options.module) {
                var module = options.module.toLowerCase();
                if (module === 'commonjs' || module === 'node') {
                    TypeScript.moduleGenTarget = TypeScript.ModuleGenTarget.Synchronous;
                } else if (module === 'amd') {
                    TypeScript.moduleGenTarget = TypeScript.ModuleGenTarget.Asynchronous;
                }
            }
            if (options.sourcemap) {
                setting.mapSourceFiles = options.sourcemap;
            }
            if (options.declaration_file || options.declaration) {
                setting.generateDeclarationFiles = true;
                if(options.declaration_file){
                    //grunt.log.writeln("'declaration_file' option now obsolate. use 'declaration' option");
                }
            }
			if (options.comments)
            {
                setting.emitComments = options.comments;
            }
			if (options.compiler)
            {
                var compiler = options.compiler;
                for (var i in compiler)
                {
                    if (i === 'styleSettings')
                    {
                        for (var s in compiler[i])
                        {
                            setting.styleSettings[s] = compiler[i][s];
                        }
                    }
                    else
                    {
                        setting[i] = compiler[i];
                    }
                }
            }
        }

        if(path.extname(destPath) === ".js"){
            var originalDestPath = destPath;
            destPath = path.resolve(currentPath, destPath);
            setting.outputOne(destPath);
        }

        var units = [{
            fileName: libDPath,
            code: grunt.file.read(libDPath)
        }];

        var resolutionDispatcher = {
            postResolutionError : function (errorFile, errorMessage) {
                grunt.fail.warn(errorFile + " : " + errorMessage);
            },
            postResolution : function (path, code) {
                if(!units.some(function(u) { return u.fileName === path;})){
                    units.push({fileName: path, code: code.content});
                }
            }
        };

        srces.forEach(function(src){
            resolver.resolveCode(path.resolve(currentPath, src), "", false, resolutionDispatcher);
        });

        var compiler = new TypeScript.TypeScriptCompiler(io.stderr, new TypeScript.NullLogger(), setting);
        compiler.setErrorOutput(io.stderr);

        units.forEach(function(unit) {
            if (!unit.code){
                unit.code = grunt.file.read(unit.fileName);
            }
            compiler.addUnit(unit.code, unit.fileName, false);
        });

        compiler.typeCheck();
        compiler.emit(io.createFile);
        compiler.emitDeclarationFile(io.createFile);

        var result = {js: [], m: [], d: [], other: []};
        io.getCreatedFiles().forEach(function(item){
            var file = item.substr(currentPath.length + 1);
            if(/\.js$/.test(file)) result.js.push(file);
            else if(/\.js\.map$/.test(file)) result.m.push(file);
            else if(/\.d\.ts$/.test(file)) result.d.push(file);
            else result.other.push(file);
        });
        var resultMessage = "js: " + result.js.length + " files, map: " +
                result.m.length + " files, declaration: " +
                result.d.length + " files";

        if(!setting.outputMany){
            grunt.log.writeln("File " + (result.js[0]).cyan + " created.");
            grunt.log.writeln(resultMessage);
        }else{
            grunt.log.writeln(io.getCreatedFiles().length + " Files created. " + resultMessage);
        }

        return true;
    };
};
