package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

const (
	createNoWindow = 0x08000000
	showNormal     = 1
	errorIcon      = 0x10
)

// The packager sets action for the start and stop executables.
var action = "start-service"

func main() {
	if err := run(); err != nil {
		title, _ := syscall.UTF16PtrFromString("Chat Demo Web")
		message, _ := syscall.UTF16PtrFromString(err.Error())
		messageBox := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
		messageBox.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), errorIcon)
		os.Exit(1)
	}
}

func run() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	folder := filepath.Dir(executable)
	node := filepath.Join(folder, "runtime", "node.exe")
	launcher := filepath.Join(folder, "proxy", "windows-launcher.mjs")
	command := exec.Command(node, launcher, action)
	command.Dir = folder
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
	output, err := command.Output()
	if err != nil {
		if failed, ok := err.(*exec.ExitError); ok {
			if message := strings.TrimSpace(string(failed.Stderr)); message != "" {
				return errors.New(message)
			}
		}
		return fmt.Errorf("Could not run Chat Demo Web. Extract the full ZIP and try again.\n\n%w", err)
	}
	if action == "stop" {
		return nil
	}

	url := strings.TrimSpace(string(output))
	const localPrefix = "http://localhost:"
	port, parseError := strconv.ParseUint(strings.TrimPrefix(url, localPrefix), 10, 16)
	if !strings.HasPrefix(url, localPrefix) || parseError != nil || port == 0 {
		return errors.New("Chat Demo Web did not provide a local URL.")
	}
	address, err := syscall.UTF16PtrFromString(url)
	if err != nil {
		return err
	}
	open := syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")
	result, _, _ := open.Call(0, 0, uintptr(unsafe.Pointer(address)), 0, 0, showNormal)
	if result <= 32 {
		return fmt.Errorf("Chat Demo Web is running. Open %s in your browser.", url)
	}
	return nil
}
