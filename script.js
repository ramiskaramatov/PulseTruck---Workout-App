"use strict";

// --- Workout Classes ---
class Workout {
  date = new Date();
  id = (Date.now() + "").slice(-10);

  constructor(coords, distance, duration) {
    // Check if coords is a valid array with two numbers
    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      !coords.every((num) => typeof num === "number")
    ) {
      console.error("Invalid coords provided to Workout constructor:", coords);
      // Handle the error appropriately, maybe throw an error or set default coords
      // For now, let's log it and allow potential downstream errors
      this.coords = [0, 0]; // Example default or error state
    } else {
      this.coords = coords; // [lat, lng]
    }
    this.distance = distance; // in km
    this.duration = duration; // in min
  }

  _setDescription() {
    // prettier-ignore
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // Ensure date is a valid Date object before calling getMonth/getDate
    if (this.date instanceof Date && !isNaN(this.date)) {
      this.description = `${this.type[0].toUpperCase()}${this.type.slice(
        1
      )} on ${months[this.date.getMonth()]} ${this.date.getDate()}`;
    } else {
      // Handle cases where date might be invalid (e.g., after JSON parsing if not handled correctly)
      console.error("Invalid date object for workout:", this);
      this.description = `${this.type[0].toUpperCase()}${this.type.slice(
        1
      )} on Invalid Date`;
    }
  }
}

class Running extends Workout {
  type = "running";

  constructor(coords, distance, duration, cadence) {
    super(coords, distance, duration);
    this.cadence = cadence;
    this.calcPace();
    this._setDescription(); // Set description after type is known
  }

  calcPace() {
    // Pace: min/km
    this.pace = this.duration / this.distance;
    return this.pace;
  }
}

class Cycling extends Workout {
  type = "cycling";

  constructor(coords, distance, duration, elevationGain) {
    super(coords, distance, duration);
    this.elevationGain = elevationGain;
    this.calcSpeed();
    this._setDescription(); // Set description after type is known
  }

  calcSpeed() {
    // Speed: km/h
    this.speed = this.distance / (this.duration / 60);
    return this.speed;
  }
}

// --- DOM Elements ---
const form = document.querySelector(".form");
const containerWorkouts = document.querySelector(".workouts");
const inputType = document.querySelector(".form__input--type");
const inputDistance = document.querySelector(".form__input--distance");
const inputDuration = document.querySelector(".form__input--duration");
const inputCadence = document.querySelector(".form__input--cadence");
const inputElevation = document.querySelector(".form__input--elevation");
const cancelButton = document.querySelector(".form__btn--cancel");

// --- Application Class ---
class App {
  #map;
  #mapZoomLevel = 17; // Increased zoom level slightly
  #mapEvent;
  #workouts = [];
  #markers = new Map(); // To store map markers [id, markerObject]
  #editMode = false;
  #editId = null;

  constructor() {
    // Get user's position
    this._getPosition();

    // Get data from local storage
    this._getLocalStorage(); // Load workouts first

    // Load sorting preference
    this._loadSortPreference();

    // Attach event handlers
    form.addEventListener("submit", this._newOrEditWorkout.bind(this)); // Renamed handler

    inputType.addEventListener("change", this._toggleElevationField);
    containerWorkouts.addEventListener(
      "click",
      this._handleWorkoutClick.bind(this)
    ); // Handles clicks on list items

    document
      .querySelector(".btn--delete-all")
      ?.addEventListener("click", this._deleteAllWorkouts.bind(this));

    document
      .querySelector(".btn--sort")
      ?.addEventListener("change", this._sortWorkouts.bind(this)); // Keep sorting with reload for simplicity for now

    document
      .querySelector(".form__btn--cancel")
      ?.addEventListener("click", this._hideForm.bind(this));

    cancelButton.addEventListener("click", () => {
      form.classList.add("hidden"); // Hide the form with animation
    });
  }

  _getPosition() {
    if (navigator.geolocation)
      navigator.geolocation.getCurrentPosition(
        this._loadMap.bind(this),
        function () {
          alert("Could not get your position");
        }
      );
  }

  _loadMap(position) {
    const { latitude, longitude } = position.coords;
    const coords = [latitude, longitude];

    this.#map = L.map("map").setView(coords, this.#mapZoomLevel);

    L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.#map);

    this.#map.on("click", this._showForm.bind(this));

    // Render stored workout markers
    this.#workouts.forEach((work) => {
      this._renderWorkoutMarker(work);
    });

    // After rendering markers, re-apply sorting to match UI state
    const sortBy = localStorage.getItem("sortBy");
    if (sortBy) {
      this._sortWorkouts({ target: { value: sortBy } });
    }

    // Now center map on top (sorted) workout
    const topWorkout = this.#workouts[this.#workouts.length - 1];
    if (topWorkout?.coords) {
      this.#map.setView(topWorkout.coords, this.#mapZoomLevel, {
        animate: true,
        pan: { duration: 1 },
      });
    }
  }

  _showForm(mapE) {
    // If already in edit mode, don't overwrite mapEvent with click location
    if (!this.#editMode) {
      this.#mapEvent = mapE; // Store click event details only for *new* workouts
    }
    form.classList.remove("hidden");
    inputDistance.focus();
  }

  _hideForm() {
    inputDistance.value =
      inputDuration.value =
      inputCadence.value =
      inputElevation.value =
        "";

    form.style.display = "none";
    form.classList.add("hidden");
    setTimeout(() => (form.style.display = "block"), 1000);

    // ✅ UNHIDE the workout that was hidden
    if (this.#editId) {
      const workoutEl = document.querySelector(
        `.workout[data-id="${this.#editId}"]`
      );
      if (workoutEl) workoutEl.classList.remove("hidden");
    }

    this.#editMode = false;
    this.#editId = null;
    form.querySelector(".form__btn").textContent = "OK";
  }

  _toggleElevationField() {
    inputElevation.closest(".form__row").classList.toggle("form__row--hidden");
    inputCadence.closest(".form__row").classList.toggle("form__row--hidden");
  }

  // Combined handler for submitting new or edited workouts
  _newOrEditWorkout(e) {
    if (e.submitter && e.submitter.classList.contains("form__btn--cancel")) {
      e.preventDefault();
      this._hideForm();
      return;
    }

    e.preventDefault();

    // Helper functions
    const validInputs = (...inputs) =>
      inputs.every((inp) => Number.isFinite(inp));
    const allPositive = (...inputs) => inputs.every((inp) => inp > 0);

    // Get data from form
    const type = inputType.value;
    const distance = +inputDistance.value;
    const duration = +inputDuration.value;
    let workout;

    // --- Handle Editing ---
    if (this.#editMode && this.#editId) {
      const workoutIndex = this.#workouts.findIndex(
        (w) => w.id === this.#editId
      );
      if (workoutIndex === -1) {
        console.error("Workout to edit not found!");
        this._hideForm();
        return;
      }
      const originalWorkout = this.#workouts[workoutIndex];
      const coords = originalWorkout.coords; // Keep original coords

      if (type === "running") {
        const cadence = +inputCadence.value;
        if (
          !validInputs(distance, duration, cadence) ||
          !allPositive(distance, duration, cadence)
        )
          return alert("Inputs must be positive numbers!");

        workout = new Running(coords, distance, duration, cadence);
      } else {
        // type === 'cycling'
        const elevation = +inputElevation.value;
        // Allow zero elevation, but distance/duration must be positive
        if (
          !validInputs(distance, duration, elevation) ||
          !allPositive(distance, duration) ||
          elevation < 0
        )
          return alert(
            "Distance/Duration must be positive numbers. Elevation cannot be negative."
          );

        workout = new Cycling(coords, distance, duration, elevation);
      }

      // Restore original ID and Date, update in array
      workout.id = originalWorkout.id;
      workout.date = new Date(originalWorkout.date); // Ensure it's a Date object
      workout._setDescription(); // Recalculate description
      this.#workouts[workoutIndex] = workout;

      // Update UI
      this._updateWorkoutInList(workout); // Update the LI element in the DOM
      this._updateWorkoutMarker(workout); // Update the marker popup

      // Reset state & hide form
      this.#editMode = false;
      this.#editId = null;
      form.querySelector(".form__btn").textContent = "OK";
      this._hideForm();

      // --- Handle Adding New Workout ---
    } else {
      if (!this.#mapEvent) {
        alert("Please click on the map to set the workout location first!");
        return;
      }
      const { lat, lng } = this.#mapEvent.latlng;
      const coords = [lat, lng];

      if (type === "running") {
        const cadence = +inputCadence.value;
        if (
          !validInputs(distance, duration, cadence) ||
          !allPositive(distance, duration, cadence)
        )
          return alert("Inputs must be positive numbers!");

        workout = new Running(coords, distance, duration, cadence);
      } else {
        // type === 'cycling'
        const elevation = +inputElevation.value;
        // Allow zero elevation, but distance/duration must be positive
        if (
          !validInputs(distance, duration, elevation) ||
          !allPositive(distance, duration) ||
          elevation < 0
        )
          return alert(
            "Distance/Duration must be positive numbers. Elevation cannot be negative."
          );

        workout = new Cycling(coords, distance, duration, elevation);
      }

      // Add new object to workout array
      this.#workouts.push(workout);

      // Render workout on list
      this._renderWorkoutToList(workout);

      // Render workout on map
      this._renderWorkoutMarker(workout);

      // Hide form + clear input fields
      this._hideForm();
    }

    // --- Common: Set local storage ---
    this._setLocalStorage();
  }

  // Generates the HTML string for a single workout <li> element
  _renderWorkoutHTML(workout) {
    let html = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <h2 class="workout__title">${workout.description}</h2>
        <div class="workout__details">
          <span class="workout__icon">${
            workout.type === "running" ? "🏃‍♂️" : "🚴‍♀️"
          }</span>
          <span class="workout__value">${workout.distance}</span>
          <span class="workout__unit">km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⏱</span>
          <span class="workout__value">${workout.duration}</span>
          <span class="workout__unit">min</span>
        </div>`;

    if (workout.type === "running") {
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡️</span>
          <span class="workout__value">${workout.pace.toFixed(1)}</span>
          <span class="workout__unit">min/km (pace)</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">🦶🏼</span>
          <span class="workout__value">${workout.cadence}</span>
          <span class="workout__unit">spm</span>
        </div>`;
    }

    if (workout.type === "cycling") {
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡️</span>
          <span class="workout__value">${workout.speed.toFixed(1)}</span>
          <span class="workout__unit">km/h</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⛰</span>
          <span class="workout__value">${workout.elevationGain}</span>
          <span class="workout__unit">m</span>
        </div>`;
    }

    html += `
        <button class="btn btn--edit">Edit</button>
        <button class="btn btn--delete">Delete</button>
      </li>`;

    return html;
  }

  // Renders a workout into the list in the DOM
  _renderWorkoutToList(workout) {
    const html = this._renderWorkoutHTML(workout);
    form.insertAdjacentHTML("afterend", html);
  }

  // Updates an existing workout's <li> element in the DOM
  _updateWorkoutInList(workout) {
    const workoutLi = document.querySelector(
      `.workout[data-id="${workout.id}"]`
    );
    if (!workoutLi) {
      console.error(
        "Could not find workout element in list to update:",
        workout.id
      );
      return;
    }
    const newHtml = this._renderWorkoutHTML(workout);
    // Replace the entire list item with the updated HTML
    workoutLi.outerHTML = newHtml;
  }

  // Renders a marker on the map for a workout
  _renderWorkoutMarker(workout) {
    if (!this.#map) {
      console.warn("Map not loaded yet, cannot render marker for:", workout.id);
      return; // Don't try to add marker if map isn't ready
    }
    if (!workout.coords || workout.coords.length !== 2) {
      console.error("Invalid coordinates for rendering marker:", workout);
      return; // Don't add marker if coords are invalid
    }

    const marker = L.marker(workout.coords)
      .addTo(this.#map)
      .bindPopup(
        L.popup({
          maxWidth: 250,
          minWidth: 100,
          autoClose: false,
          closeOnClick: false,
          className: `${workout.type}-popup`,
        })
      )
      .setPopupContent(
        `${workout.type === "running" ? "🏃‍♂️" : "🚴‍♀️"} ${workout.description}`
      )
      .openPopup();

    // Store the marker reference
    this.#markers.set(workout.id, marker);
  }

  // Updates the popup content of an existing marker
  _updateWorkoutMarker(workout) {
    const marker = this.#markers.get(workout.id);
    if (!marker) {
      console.error("Could not find marker to update:", workout.id);
      return;
    }
    // Update popup content using the workout's latest description
    marker.setPopupContent(
      `${workout.type === "running" ? "🏃‍♂️" : "🚴‍♀️"} ${workout.description}`
    );
  }

  _setLocalStorage() {
    localStorage.setItem("workouts", JSON.stringify(this.#workouts));
  }

  _getLocalStorage() {
    const data = JSON.parse(localStorage.getItem("workouts"));

    if (!data) return;

    // Re-hydrate workout objects
    this.#workouts = data.map((obj) => {
      let workout;
      // IMPORTANT: Re-create objects to restore prototype chain
      if (obj.type === "running") {
        workout = new Running(
          obj.coords,
          obj.distance,
          obj.duration,
          obj.cadence
        );
      } else {
        // 'cycling'
        workout = new Cycling(
          obj.coords,
          obj.distance,
          obj.duration,
          obj.elevationGain
        );
      }
      // Restore original ID and convert date string back to Date object
      workout.id = obj.id;
      workout.date = new Date(obj.date);
      workout._setDescription(); // Ensure description is set correctly after rehydration
      return workout;
    });

    // Render workouts to the list (markers are rendered in _loadMap callback)
    this.#workouts.forEach((work) => {
      this._renderWorkoutToList(work);
    });
  }

  // Handles clicks within the workouts list (edit, delete, move to popup)
  _handleWorkoutClick(e) {
    const workoutEl = e.target.closest(".workout");

    if (!workoutEl) return; // Exit if click wasn't inside a workout item

    const workoutId = workoutEl.dataset.id;
    const workout = this.#workouts.find((work) => work.id === workoutId);

    if (!workout) return; // Should not happen if data-id is valid

    // --- Handle Delete Button ---
    if (e.target.classList.contains("btn--delete")) {
      this._deleteWorkout(workoutId);
    }
    // --- Handle Edit Button ---
    else if (e.target.classList.contains("btn--edit")) {
      this._editWorkout(workout);
    }
    // --- Handle Click on Workout Item (Move map) ---
    else {
      this._moveToPopup(workout);
    }
  }

  _deleteWorkout(id) {
    if (!confirm("Are you sure you want to delete this workout?")) return;

    // 1. Find index for potential later use (though filter is easier here)
    // const workoutIndex = this.#workouts.findIndex(work => work.id === id);
    // if (workoutIndex === -1) return;

    // 2. Remove from array
    this.#workouts = this.#workouts.filter((work) => work.id !== id);

    // 3. Update local storage
    this._setLocalStorage();

    // 4. Remove from DOM list
    document.querySelector(`.workout[data-id="${id}"]`)?.remove();

    // 5. Remove marker from map and from our tracking map
    const marker = this.#markers.get(id);
    if (marker) {
      marker.remove(); // Remove from Leaflet map
      this.#markers.delete(id); // Remove from our Map object
    } else {
      console.warn("Could not find marker to delete for ID:", id);
    }
    // No page reload needed
  }

  _editWorkout(workout) {
    // 1. Show form
    this.#mapEvent = null;
    form.classList.remove("hidden");
    inputDistance.focus();

    // 1.5 Hide the workout element
    const workoutEl = document.querySelector(
      `.workout[data-id="${workout.id}"]`
    );
    if (workoutEl) {
      workoutEl.classList.add("hidden");
    }

    // 2. Fill in form
    inputType.value = workout.type;
    inputDistance.value = workout.distance;
    inputDuration.value = workout.duration;

    if (workout.type === "running") {
      inputCadence.value = workout.cadence;
      inputElevation.closest(".form__row").classList.add("form__row--hidden");
      inputCadence.closest(".form__row").classList.remove("form__row--hidden");
    } else {
      inputElevation.value = workout.elevationGain;
      inputCadence.closest(".form__row").classList.add("form__row--hidden");
      inputElevation
        .closest(".form__row")
        .classList.remove("form__row--hidden");
    }

    // 3. Set state
    this.#editMode = true;
    this.#editId = workout.id;
    form.querySelector(".form__btn").textContent = "Save Changes";
  }

  _moveToPopup(workout) {
    if (!this.#map) return; // Map might not be loaded yet

    this.#map.setView(workout.coords, this.#mapZoomLevel, {
      animate: true,
      pan: {
        duration: 1,
      },
    });
  }

  _deleteAllWorkouts() {
    if (!confirm("Are you sure you want to delete ALL workouts?")) return;

    // 1. Clear array
    this.#workouts = [];

    // 2. Update local storage (save empty array)
    this._setLocalStorage();

    // 3. Clear DOM list (remove all <li> children except the form)
    const workouts = Array.from(containerWorkouts.children);
    workouts.forEach((child) => {
      if (!child.classList.contains("form")) {
        child.remove();
      }
    });

    // 4. Remove all markers from map and clear tracking map
    this.#markers.forEach((marker) => marker.remove());
    this.#markers.clear();
  }

  _sortWorkouts(e) {
    const sortBy = e?.target?.value || "date";
    if (!sortBy) return;

    // Create a copy to avoid mutating the original array during sort
    const workoutsCopy = [...this.#workouts];

    // Perform sort on the copy
    switch (sortBy) {
      case "date":
        workoutsCopy.sort((a, b) => new Date(a.date) - new Date(b.date));
        break;
      case "distance":
        workoutsCopy.sort((a, b) => a.distance - b.distance);
        break;
      case "duration":
        workoutsCopy.sort((a, b) => a.duration - b.duration);
        break;
      case "cadence":
        workoutsCopy.sort((a, b) => {
          const aVal = a.type === "running" ? a.cadence : -Infinity;
          const bVal = b.type === "running" ? b.cadence : -Infinity;
          return aVal - bVal;
        });
        break;
      case "pace":
        workoutsCopy.sort((a, b) => {
          // For running workouts, use pace (min/km)
          // For cycling workouts, they'll appear after running workouts
          const aPace = a.type === "running" ? a.pace : Infinity;
          const bPace = b.type === "running" ? b.pace : Infinity;
          return aPace - bPace; // Sort ascending (lower pace = faster)
        });
        break;
      case "elevation":
        workoutsCopy.sort((a, b) => {
          const aElev = a.type === "cycling" ? a.elevationGain : -Infinity;
          const bElev = b.type === "cycling" ? b.elevationGain : -Infinity;
          return aElev - bElev; // Sort descending (highest elevation first)
        });
        break;
      default:
        return;
    }

    // Update the array reference
    this.#workouts = workoutsCopy;

    // Update local storage with sorted array
    this._setLocalStorage();

    // Clear current list display (except the form)
    const workouts = Array.from(containerWorkouts.children);
    workouts.forEach((child) => {
      if (!child.classList.contains("form")) {
        child.remove();
      }
    });

    // Re-render all workouts from the now-sorted array
    this.#workouts.forEach((work) => this._renderWorkoutToList(work));

    localStorage.setItem("sortBy", sortBy);

    // Center the map on the top workout after sorting
    if (this.#map) {
      const topWorkout = this.#workouts[this.#workouts.length - 1];

      if (topWorkout && topWorkout.coords) {
        this.#map.setView(topWorkout.coords, this.#mapZoomLevel, {
          animate: true,
          pan: {
            duration: 1,
          },
        });
      }
    }
  }

  // Loads the saved sorting preference
  _loadSortPreference() {
    const sortBy = localStorage.getItem("sortBy");
    if (sortBy) {
      const sortSelect = document.querySelector(".btn--sort");
      if (sortSelect) {
        sortSelect.value = sortBy;
        // Optionally trigger the sort immediately
        this._sortWorkouts({ target: { value: sortBy } });
      }
    }
  }

  reset() {
    if (confirm("This will delete all data. Are you sure?")) {
      localStorage.removeItem("workouts");
      location.reload();
    }
  }
}

// Initialize the application
const app = new App();
