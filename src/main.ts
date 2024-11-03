const button = document.createElement("button");
button.innerHTML = "Click Me";

button.addEventListener("click", () => {
  alert("You clicked the button!");
});

document.body.append(button);
