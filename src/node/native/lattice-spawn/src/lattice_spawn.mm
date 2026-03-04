/**
 * lattice_spawn — Native NAPI addon for spawning processes via NSTask.
 *
 * In the macOS App Sandbox, Node.js's child_process.spawn() (which uses
 * libuv's posix_spawn/fork+exec) doesn't properly propagate sandbox
 * inheritance attributes, causing EPERM errors. Apple's NSTask API
 * handles this correctly.
 *
 * Exports:
 *   spawn(command, args, options, exitCallback) → { pid, stdinFd, stdoutFd, stderrFd }
 *   kill(pid, signal) → number
 */

#import <napi.h>
#import <Foundation/Foundation.h>
#include <unistd.h>
#include <signal.h>

/**
 * spawn(command: string, args: string[], options: object, exitCallback: function)
 *
 * Options:
 *   cwd?: string         — working directory
 *   env?: object          — environment variables (full replacement)
 *   stdin?: boolean       — create stdin pipe (default: false)
 *   stdout?: boolean      — create stdout pipe (default: true)
 *   stderr?: boolean      — create stderr pipe (default: true)
 *
 * Returns: { pid: number, stdinFd: number, stdoutFd: number, stderrFd: number }
 *   File descriptors are -1 if the corresponding pipe was not requested.
 *   Returned fds are dup()'d — caller owns them and must close them.
 *
 * The exitCallback(code, signal) is called when the process terminates,
 * marshalled to the Node.js event loop via ThreadSafeFunction.
 */
static Napi::Value Spawn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // ── Validate arguments ──
  if (info.Length() < 4) {
    Napi::TypeError::New(env, "spawn requires 4 arguments: command, args, options, exitCallback")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (!info[0].IsString() || !info[1].IsArray() || !info[2].IsObject() || !info[3].IsFunction()) {
    Napi::TypeError::New(env, "spawn(command: string, args: string[], options: object, cb: function)")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // ── Parse command & args ──
  std::string command = info[0].As<Napi::String>().Utf8Value();
  Napi::Array argsArray = info[1].As<Napi::Array>();
  Napi::Object options = info[2].As<Napi::Object>();
  Napi::Function exitCallback = info[3].As<Napi::Function>();

  NSMutableArray<NSString*>* nsArgs = [NSMutableArray arrayWithCapacity:argsArray.Length()];
  for (uint32_t i = 0; i < argsArray.Length(); i++) {
    Napi::Value val = argsArray.Get(i);
    if (val.IsString()) {
      [nsArgs addObject:[NSString stringWithUTF8String:val.As<Napi::String>().Utf8Value().c_str()]];
    }
  }

  // ── Parse options ──
  std::string cwd;
  if (options.Has("cwd") && options.Get("cwd").IsString()) {
    cwd = options.Get("cwd").As<Napi::String>().Utf8Value();
  }

  bool wantStdin = false;
  if (options.Has("stdin") && options.Get("stdin").IsBoolean()) {
    wantStdin = options.Get("stdin").As<Napi::Boolean>().Value();
  }

  bool wantStdout = true;
  if (options.Has("stdout") && options.Get("stdout").IsBoolean()) {
    wantStdout = options.Get("stdout").As<Napi::Boolean>().Value();
  }

  bool wantStderr = true;
  if (options.Has("stderr") && options.Get("stderr").IsBoolean()) {
    wantStderr = options.Get("stderr").As<Napi::Boolean>().Value();
  }

  // ── Parse environment ──
  NSMutableDictionary<NSString*, NSString*>* nsEnv = nil;
  if (options.Has("env") && options.Get("env").IsObject()) {
    nsEnv = [NSMutableDictionary new];
    Napi::Object envObj = options.Get("env").As<Napi::Object>();
    Napi::Array envKeys = envObj.GetPropertyNames();
    for (uint32_t i = 0; i < envKeys.Length(); i++) {
      Napi::Value keyVal = envKeys.Get(i);
      if (!keyVal.IsString()) continue;
      std::string key = keyVal.As<Napi::String>().Utf8Value();
      Napi::Value val = envObj.Get(key);
      if (val.IsString()) {
        [nsEnv setObject:[NSString stringWithUTF8String:val.As<Napi::String>().Utf8Value().c_str()]
                  forKey:[NSString stringWithUTF8String:key.c_str()]];
      }
    }
  }

  // ── Create NSTask ──
  NSTask* task = [[NSTask alloc] init];
  [task setLaunchPath:[NSString stringWithUTF8String:command.c_str()]];
  [task setArguments:nsArgs];

  if (!cwd.empty()) {
    [task setCurrentDirectoryPath:[NSString stringWithUTF8String:cwd.c_str()]];
  }
  if (nsEnv != nil) {
    [task setEnvironment:nsEnv];
  }

  // ── Set up pipes ──
  NSPipe* stdinPipe = wantStdin ? [NSPipe pipe] : nil;
  NSPipe* stdoutPipe = wantStdout ? [NSPipe pipe] : nil;
  NSPipe* stderrPipe = wantStderr ? [NSPipe pipe] : nil;

  if (stdinPipe) [task setStandardInput:stdinPipe];
  if (stdoutPipe) [task setStandardOutput:stdoutPipe];
  if (stderrPipe) [task setStandardError:stderrPipe];

  // ── Set up exit callback via ThreadSafeFunction ──
  // The terminationHandler fires on an arbitrary dispatch queue.
  // We use TSFN to marshal the callback to the Node.js event loop.
  struct ExitData {
    int exitCode;
    int signalNum;
  };

  auto tsfn = Napi::ThreadSafeFunction::New(
    env,
    exitCallback,
    "lattice_spawn_exit",
    0,   // maxQueueSize (unlimited)
    1    // initialThreadCount
  );

  // Copy tsfn for the block capture (TSFN is ref-counted, copy is fine)
  auto tsfnCopy = tsfn;

  [task setTerminationHandler:^(NSTask* completedTask) {
    int status = [completedTask terminationStatus];
    NSTaskTerminationReason reason = [completedTask terminationReason];

    ExitData* data = new ExitData;
    if (reason == NSTaskTerminationReasonExit) {
      data->exitCode = status;
      data->signalNum = 0;
    } else {
      // NSTaskTerminationReasonUncaughtSignal
      data->exitCode = 0;
      data->signalNum = status;
    }

    auto callbackFn = [](Napi::Env cbEnv, Napi::Function jsCallback, ExitData* d) {
      jsCallback.Call({
        Napi::Number::New(cbEnv, d->exitCode),
        Napi::Number::New(cbEnv, d->signalNum)
      });
      delete d;
    };

    napi_status callStatus = tsfnCopy.BlockingCall(data, callbackFn);
    if (callStatus == napi_ok) {
      tsfnCopy.Release();
    } else {
      delete data;
      tsfnCopy.Release();
    }
  }];

  // ── Launch ──
  @try {
    [task launch];
  } @catch (NSException* exception) {
    tsfn.Release();
    std::string errMsg = std::string("NSTask launch failed: ") +
      [[exception reason] UTF8String];
    Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // ── Extract and dup() file descriptors ──
  // We dup() so Node.js owns independent fd copies.
  // NSPipe/NSFileHandle may close their fds when deallocated.
  int stdinFd = -1;
  int stdoutFd = -1;
  int stderrFd = -1;

  if (stdinPipe) {
    int rawFd = [[stdinPipe fileHandleForWriting] fileDescriptor];
    stdinFd = dup(rawFd);
    // Close the read end we don't need (task has it)
    [[stdinPipe fileHandleForReading] closeFile];
  }
  if (stdoutPipe) {
    int rawFd = [[stdoutPipe fileHandleForReading] fileDescriptor];
    stdoutFd = dup(rawFd);
    // Close the write end we don't need (task has it)
    [[stdoutPipe fileHandleForWriting] closeFile];
  }
  if (stderrPipe) {
    int rawFd = [[stderrPipe fileHandleForReading] fileDescriptor];
    stderrFd = dup(rawFd);
    [[stderrPipe fileHandleForWriting] closeFile];
  }

  // ── Build result ──
  pid_t pid = [task processIdentifier];

  Napi::Object result = Napi::Object::New(env);
  result.Set("pid", Napi::Number::New(env, pid));
  result.Set("stdinFd", Napi::Number::New(env, stdinFd));
  result.Set("stdoutFd", Napi::Number::New(env, stdoutFd));
  result.Set("stderrFd", Napi::Number::New(env, stderrFd));

  return result;
}

/**
 * kill(pid: number, signal?: number) → number
 *
 * Send a signal to a process. Returns 0 on success, -1 on error.
 * Default signal is SIGTERM (15).
 */
static Napi::Value Kill(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "kill requires pid as first argument")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int pid = info[0].As<Napi::Number>().Int32Value();
  int sig = SIGTERM;
  if (info.Length() > 1 && info[1].IsNumber()) {
    sig = info[1].As<Napi::Number>().Int32Value();
  }

  int ret = kill(pid, sig);
  return Napi::Number::New(env, ret);
}

/**
 * Module initialization.
 */
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("spawn", Napi::Function::New(env, Spawn));
  exports.Set("kill", Napi::Function::New(env, Kill));
  return exports;
}

NODE_API_MODULE(lattice_spawn, Init)
