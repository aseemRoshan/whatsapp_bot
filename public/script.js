function addStudent() {
  const studentDiv = document.createElement('div');
  studentDiv.className = 'student-entry';
  studentDiv.innerHTML = `
    <input type="text" placeholder="Name" class="student-name">
    <select class="input-type">
      <option value="contact">Select Contact</option>
      <option value="manual">Enter Number</option>
    </select>
    <select class="student-whatsapp contact-input" style="display: block;">
      <option value="">Select a contact</option>
    </select>
    <input type="tel" class="student-number manual-input" placeholder="Enter phone number (e.g., 9123456789)" style="display: none;">
    <button onclick="removeStudent(this)">Remove</button>
  `;
  const select = studentDiv.querySelector('.student-whatsapp');
  if (!window.contacts || window.contacts.length === 0) {
    console.log('No contacts available to populate new dropdown');
  } else {
    window.contacts.forEach(contact => {
      const option = document.createElement('option');
      option.value = contact.id;
      option.text = contact.name;
      select.appendChild(option);
    });
  }
  document.getElementById('students-list').appendChild(studentDiv);
  studentDiv.querySelector('.input-type').addEventListener('change', toggleInputType);
}

function removeStudent(button) {
  button.parentElement.remove();
}

function saveSetup() {
  const groupId = document.getElementById('group-id').value;
  const batch = document.getElementById('batch').value.trim();
  
  let reportHours = parseInt(document.getElementById('report-hours').value);
  const reportMinutes = document.getElementById('report-minutes').value.padStart(2, '0');
  const reportPeriod = document.getElementById('report-period').value;
  if (reportPeriod === 'PM' && reportHours !== 12) reportHours += 12;
  if (reportPeriod === 'AM' && reportHours === 12) reportHours = 0;
  const reportTime = `${reportHours.toString().padStart(2, '0')}:${reportMinutes}`;

  let startHours = parseInt(document.getElementById('start-hours').value);
  const startMinutes = document.getElementById('start-minutes').value.padStart(2, '0');
  const startPeriod = document.getElementById('start-period').value;
  if (startPeriod === 'PM' && startHours !== 12) startHours += 12;
  if (startPeriod === 'AM' && startHours === 12) startHours = 0;
  const startTime = `${startHours.toString().padStart(2, '0')}:${startMinutes}`;

  const students = Array.from(document.getElementsByClassName('student-entry')).map(entry => {
    const name = entry.querySelector('.student-name').value;
    const inputType = entry.querySelector('.input-type').value;
    let whatsappId;
    if (inputType === 'contact') {
      whatsappId = entry.querySelector('.student-whatsapp').value;
      console.log(`[DEBUG] Contact selected for ${name}: ${whatsappId}`);
    } else {
      const phoneNumber = entry.querySelector('.student-number').value;
      if (!/^[6-9]\d{9}$/.test(phoneNumber)) {
        alert(`Invalid phone number for ${name}: ${phoneNumber}`);
        return null;
      }
      whatsappId = `91${phoneNumber}@c.us`;
      console.log(`[DEBUG] Manual ID constructed for ${name}: ${whatsappId}`);
    }
    return { name, whatsappId };
  }).filter(student => student !== null);

  if (!groupId || !batch || !reportTime || !startTime || students.length === 0 || students.some(s => !s.name || !s.whatsappId)) {
    alert('Please fill all fields correctly');
    return;
  }

  const startInMinutes = startHours * 60 + parseInt(startMinutes);
  const reportInMinutes = reportHours * 60 + parseInt(reportMinutes);
  if (startInMinutes >= reportInMinutes) {
    alert('Start time must be before report time');
    return;
  }

  console.log('Saving setup:', { groupId, batch, reportTime, startTime, students });
  fetch('/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, batch, reportTime, startTime, students })
  })
    .then(response => response.json())
    .then(data => {
      console.log('Setup response:', data);
      if (data.success) {
        alert('Setup complete! Bot is running with your settings.');
        document.getElementById('stop-bot').style.display = 'block';
      } else {
        alert('Error: ' + data.error);
      }
    })
    .catch(err => console.error('Error saving setup:', err));
}

function stopBot() {
  if (confirm('Are you sure you want to stop the bot?')) {
    fetch('/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
      .then(response => response.json())
      .then(data => {
        console.log('Stop response:', data);
        if (data.success) {
          alert('Bot stopped successfully.');
          document.getElementById('stop-bot').style.display = 'none';
        } else {
          alert('Error: ' + data.error);
        }
      })
      .catch(err => console.error('Error stopping bot:', err));
  }
}