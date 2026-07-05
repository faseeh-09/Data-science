let webcamStream
let video
let prediction
let inputImage
let predictionLabels
let theModel
let canvas
let context
let paused

const constraints = {
  video: true,
  audio: false
}

const tfjsModel = {
  imageSegmenter: 'https://cdn.jsdelivr.net/npm/@codait/max-image-segmenter'
}

const selectModelChanged = function () {
  if (webcamStream) {
    pauseVideo()
  }

  cleanup()
  const selector = document.getElementById('selectModel')
  const selectedModel = selector.value

  const inputUrl = document.getElementById('modelEndpoint')
  inputUrl.value = tfjsModel[selectedModel]

  const main = document.getElementById('max-main-content')
  main.classList.remove('nomaxvis-annotate')
  main.classList.remove('nomaxvis-extract')

  const nomaxvis = document.querySelector(':checked').getAttribute('data-no-maxvis')
  if (nomaxvis) {
    const actions = nomaxvis.split(',')
    for (let i = 0; i < actions.length; i++) {
      main.classList.add(`nomaxvis-${actions[i]}`)
    }
  }

  if (window[selectedModel]) {
    theModel = window[selectedModel]
  } else {
    theModel = null
  }

  if (webcamStream && theModel) {
    resumeVideo()
  }
}

const webcamToggled = function () {
  cleanup()
  const webcam = document.getElementById('webcamToggle').checked
  const main = document.getElementById('max-main-content')
  if (webcam) {
    main.classList.add('webcam')
    startWebcam()
  } else {
    stopWebcam()
    main.classList.remove('webcam')
    if (!document.getElementById('selectedImage').src) {
      main.classList.remove('ready')
    }
  }
}

const selectImageChanged = function (input) {
  if (input && input.files && input.files[0]) {
    cleanup()
    let reader = new FileReader()

    reader.onload = function (e) {
      let image = document.getElementById('selectedImage')
      image.onload = function () {
        const main = document.getElementById('max-main-content')
        main.classList.add('ready')
      }
      image.src = reader.result
    }

    reader.readAsDataURL(input.files[0])
  }
}

const fetchPrediction = async function (ignoreExisting) {
  const main = document.getElementById('max-main-content')

  if (prediction && prediction.status === 'ok' && !ignoreExisting) {
    return prediction
  } else if (main.className.indexOf('webcam') === -1) {
    inputImage = document.getElementById('selectedImage')
  } else {
    pauseVideo()
    inputImage = canvas
  }

  maxLog('')
  prediction = await theModel.predict(inputImage)

  // add the prediction response
  const div = document.getElementById('prediction')
  div.innerText = ''
  const c = document.createElement('code')
  c.innerText = JSON.stringify(prediction, null, 4)
  const p = document.createElement('pre')
  p.appendChild(c)
  div.appendChild(p)

  if (prediction) {
    if (prediction.segmentationMap && prediction.segmentationMap.length) {
      predictionLabels = theModel.labelsMap
    } else if ((prediction.posesDetected && !prediction.posesDetected.length) ||
      (Array.isArray(prediction) && !prediction.length)) {
      throw new Error('no prediction returned')
    }

    return prediction
  } else {
    prediction = null
    throw new Error('failed to get prediction')
  }
}

const runPrediction = async function () {
  setState('busy')

  try {
    await fetchPrediction(!!webcamStream)
    setState('json')
  } catch (err) {
    maxLog(err, true)
  }
}

const annotatePrediction = async function () {
  setState('busy')

  const outputDiv = document.getElementById('maxvisOutput')
  outputDiv.innerHTML = ''

  try {
    const pred = await fetchPrediction(!!webcamStream)
    const annotedImage = await maxvis.annotate(pred, inputImage)
    let newImg = document.createElement('img')
    newImg.src = URL.createObjectURL(annotedImage)
    outputDiv.appendChild(newImg)
    setState('vis')
  } catch (err) {
    maxLog(err, true)
  }
}

const extractPrediction = async function () {
  setState('busy')

  const outputDiv = document.getElementById('maxvisOutput')
  outputDiv.innerHTML = ''

  try {
    const pred = await fetchPrediction(!!webcamStream)
    const extractedImages = await maxvis.extract(pred, inputImage)
    extractedImages.forEach(img => {
      let label = document.createElement('label')
      label.className = 'max-label'
      if (document.getElementById('selectModel').value === 'imageSegmenter') {
        label.innerText = predictionLabels && predictionLabels.length ? predictionLabels[img.label] : img.label
      } else {
        label.innerText = img.label
      }

      let newImg = document.createElement('img')
      newImg.src = URL.createObjectURL(img.image)
      newImg.setAttribute('alt', img.label)
      newImg.setAttribute('title', img.label)

      let span = document.createElement('span')
      span.className = 'extract'
      span.appendChild(label)
      span.appendChild(newImg)

      outputDiv.appendChild(span)
    })
    setState('vis')
  } catch (err) {
    maxLog(err, true)
  }
}

const overlayPrediction = async function () {
  const prediction = await theModel.predict(canvas)
  await maxvis.overlay(prediction, canvas)
}

// get user media and start capturing video streaming
const startWebcam = async function () {
  try {
    if (!canvas || !context) {
      canvas = document.getElementById('videoCanvas')
      context = canvas.getContext('2d')

      // mirror video image
      context.translate(canvas.width, 0)
      context.scale(-1, 1)
    }

    if (!webcamStream) {
      webcamStream = await navigator.mediaDevices.getUserMedia(constraints)
      // video = document.getElementById('webcamVideo')
      video = document.createElement('video')
    }

    if (typeof video.srcObject !== 'undefined') {
      video.srcObject = webcamStream
    } else {
      video.src = URL.createObjectURL(webcamStream)
    }

    video.play()
    const main = document.getElementById('max-main-content')
    main.classList.add('ready')
    paused = false
    drawVideoToCanvas()
  } catch (err) {
    const btn = document.querySelector('.video-button')
    btn.setAttribute('disabled', 'disabled')
    maxLog(err, true)
  }
}

const stopWebcam = function () {
  if (video) {
    video.pause()
    if (video.srcObject || video.src) {
      const videoTracks = webcamStream.getVideoTracks()
      videoTracks.forEach(track => {
        track.stop()
      })

      if (typeof video.srcObject !== 'undefined') {
        video.srcObject = null
      } else {
        video.src = null
      }
    }
  }

  paused = null

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
  }

  const btn = document.querySelector('.video-button')
  if (btn.innerText === 'Resume video') {
    btn.innerText = 'Pause video'
  }
  video = null
  webcamStream = null
}

const pauseResumeVideo = function () {
  if (paused) {
    resumeVideo()
  } else {
    pauseVideo()
  }
}

const pauseVideo = function () {
  if (video) {
    paused = true
    video.pause()

    document.querySelector('.video-button').innerText = 'Resume video'
    prediction = ''
  }
}

const resumeVideo = function () {
  if (video) {
    video.play()
    paused = false
    drawVideoToCanvas()
    document.querySelector('.video-button').innerText = 'Pause video'
  }
}

// draw current video frame onto the canvas
const drawVideoToCanvas = function () {
  if (webcamStream && !paused) {
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    overlayPrediction()
    requestAnimationFrame(drawVideoToCanvas)
  }
}

const cleanup = function () {
  document.body.className = ''
  prediction = null
  maxLog('')
}

const setState = function (state) {
  const buttons = document.getElementsByTagName('button')
  const selects = document.getElementsByTagName('select')
  const inputs = document.getElementsByTagName('input')

  const elements = [...buttons, ...selects, ...inputs]

  for (let elt of elements) {
    if (state === 'busy') {
      elt.setAttribute('disabled', true)
    } else {
      elt.removeAttribute('disabled')
    }
  }

  document.body.className = state || ''
}

const maxLog = function (txt, isError) {
  const messageWrapper = document.querySelector('.max-log')
  if (messageWrapper) {
    if (txt) {
      const message = document.createElement('span')
      message.innerText = txt.message || txt
      if (isError) {
        message.className = 'max-error'
        console.error(txt)
        setState()
      }
      messageWrapper.appendChild(message)
    } else {
      messageWrapper.innerHTML = ''
    }
  }
}

const init = function () {
  // set default model
  document.getElementById('selectModel').value = 'imageSegmenter'
  selectModelChanged()
  webcamToggled()
  setState()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
