package main

import (
	"fmt"
	"strings"
)

// MaxSize is a package-level constant.
const MaxSize = 100

// GlobalVar is a package-level variable.
var GlobalVar = "hello"

// Animal represents a basic animal.
type Animal struct {
	Name string
	Age  int
}

// Speak returns the sound the animal makes.
func (a *Animal) Speak() string {
	return "sound"
}

// SetName updates the animal's name.
func (a *Animal) SetName(name string) {
	a.Name = name
}

// Speaker defines the speaking interface.
type Speaker interface {
	Speak() string
	Listen()
}

// NewAnimal creates a new Animal instance.
func NewAnimal(name string, age int) *Animal {
	return &Animal{Name: name, Age: age}
}

// FormatName formats a name string.
func FormatName(first, last string) string {
	return fmt.Sprintf("%s %s", strings.Title(first), strings.Title(last))
}
