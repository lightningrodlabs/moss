import { html } from 'lit';

export const mossIcon = (size = 58) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    viewBox="0 0 58 58"
    fill="currentColor"
  >
    <path
      d="M46.7704 47.1345C47.3861 50.513 49.8077 52.4037 53.4006 52.3196C58.0827 52.2123 59.3077 46.4096 56.5325 45.0147C54.8529 44.1708 52.9301 43.8837 52.7344 39.2786C52.4123 31.6778 54.0793 26.2578 54.1741 24.8398C54.2972 23.036 54.4235 21.1829 54.1362 19.4111C53.5931 16.0471 51.5062 13.7214 48.1154 12.5527C45.476 11.6421 42.7671 11.4855 40.0487 12.1496C37.0241 12.8891 35.1361 15.1887 35.1677 18.37C35.1866 20.1999 35.5213 22.05 35.9254 23.8509C36.5695 26.7218 36.0738 29.3028 34.23 31.6488C33.5165 32.5565 32.7019 33.3598 31.5337 33.731C30.053 34.2037 28.5186 33.6324 27.9535 32.2491C27.6314 31.4603 27.1484 29.5464 27.6251 26.2114C28.7522 18.2917 27.6662 16.9722 27.8177 12.7963C27.8556 11.761 28.3039 10.5546 28.105 8.78567C27.7672 5.77553 26.3591 4.03846 23.6376 2.45219C21.0929 0.967417 18.3145 0.0597345 15.3089 0.00173559C11.2582 -0.0765629 9.01656 2.50149 9.8469 6.29462C10.15 7.68949 10.6267 9.05246 11.0435 10.427C11.8486 13.0979 10.933 15.2032 9.34806 17.5377C3.16941 26.6406 -2.43463 40.8156 1.09513 50.89C2.52534 54.9789 5.03216 57.8034 9.59748 57.9948C12.0696 58.0992 15.7382 56.6464 16.7707 51.325C17.3705 48.2278 15.6025 44.4666 14.106 42.1611C13.7334 41.5898 13.3767 41.0099 13.0262 40.427C8.58718 32.9857 13.9386 20.948 16.556 18.9529C18.5166 17.4594 20.9129 18.3004 21.4559 20.629C21.6896 21.6382 21.6075 22.7431 21.5065 23.79C21.396 24.9007 20.2783 32.3245 21.3044 41.5087C21.9422 47.2186 24.389 52.7082 28.6891 54.5845C31.2622 55.7097 34.1542 55.9185 37.002 55.2689C39.553 54.6889 41.1285 52.8271 41.2327 50.3274C41.3179 48.3032 40.5223 46.4879 39.8246 44.6406C39.2657 43.1674 38.5901 41.7116 38.2618 40.1892C37.6272 37.2167 38.8079 34.7663 41.2327 32.9161C43.1712 31.4342 45.5865 32.1998 46.0569 34.5198C46.3979 36.1988 46.3253 44.6899 46.7736 47.1345H46.7704Z"
      fill="currentColor"
    />
  </svg>
`;

export const arrowLeftShortIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-arrow-left-short"
    viewBox="0 0 16 16"
  >
    <path
      fill-rule="evenodd"
      d="M12 8a.5.5 0 0 1-.5.5H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5H11.5a.5.5 0 0 1 .5.5"
    />
  </svg>
`;

export const plusIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M8 2C8.27614 2 8.5 2.22386 8.5 2.5V7.5H13.5C13.7761 7.5 14 7.72386 14 8C14 8.27614 13.7761 8.5 13.5 8.5H8.5V13.5C8.5 13.7761 8.27614 14 8 14C7.72386 14 7.5 13.7761 7.5 13.5V8.5H2.5C2.22386 8.5 2 8.27614 2 8C2 7.72386 2.22386 7.5 2.5 7.5H7.5V2.5C7.5 2.22386 7.72386 2 8 2Z"
      fill="currentColor"
    />
  </svg>
`;

export const editIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path
      d="M15.5016 1.93934C15.6969 2.1346 15.6969 2.45118 15.5016 2.64645L14.4587 3.68933L12.4587 1.68933L13.5016 0.646447C13.6969 0.451184 14.0134 0.451185 14.2087 0.646447L15.5016 1.93934Z"
      fill="currentColor"
    />
    <path
      d="M13.7516 4.39644L11.7516 2.39644L4.93861 9.20943C4.88372 9.26432 4.84237 9.33123 4.81782 9.40487L4.01326 11.8186C3.94812 12.014 4.13405 12.1999 4.32949 12.1348L6.74317 11.3302C6.81681 11.3057 6.88372 11.2643 6.93861 11.2094L13.7516 4.39644Z"
      fill="currentColor"
    />
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M1 13.5C1 14.3284 1.67157 15 2.5 15H13.5C14.3284 15 15 14.3284 15 13.5V7.5C15 7.22386 14.7761 7 14.5 7C14.2239 7 14 7.22386 14 7.5V13.5C14 13.7761 13.7761 14 13.5 14H2.5C2.22386 14 2 13.7761 2 13.5V2.5C2 2.22386 2.22386 2 2.5 2H9C9.27614 2 9.5 1.77614 9.5 1.5C9.5 1.22386 9.27614 1 9 1H2.5C1.67157 1 1 1.67157 1 2.5V13.5Z"
      fill="currentColor"
    />
  </svg>
`;

export const rebootIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path
      d="M1.16089 8C1.16089 11.7779 4.22352 14.8406 8.00146 14.8406C11.7794 14.8406 14.842 11.7779 14.842 8C14.842 4.22244 11.78 1.15998 8.0025 1.15942C7.68234 1.15937 7.42283 0.899789 7.42288 0.579624C7.42293 0.259459 7.68251 -4.75176e-05 8.00268 6.52637e-09C12.4204 0.000655764 16.0015 3.58217 16.0015 8C16.0015 12.4183 12.4197 16 8.00146 16C3.58319 16 0.00146484 12.4183 0.00146484 8C0.00146484 6.32812 0.51719 4.73714 1.44692 3.41168L0.783601 2.83507C0.434162 2.5313 0.564278 1.96067 1.01086 1.83842L3.53086 1.14855C3.92984 1.03933 4.31155 1.37115 4.25892 1.78145L3.92649 4.37294C3.86758 4.83218 3.3206 5.04045 2.97117 4.73669L2.3275 4.17716C1.57597 5.28995 1.16089 6.61166 1.16089 8Z"
      fill="currentColor"
    />
  </svg>
`;

export const trashIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path
      d="M5.5 5.5C5.77614 5.5 6 5.72386 6 6V12C6 12.2761 5.77614 12.5 5.5 12.5C5.22386 12.5 5 12.2761 5 12V6C5 5.72386 5.22386 5.5 5.5 5.5Z"
      fill="currentColor"
    />
    <path
      d="M8 5.5C8.27614 5.5 8.5 5.72386 8.5 6V12C8.5 12.2761 8.27614 12.5 8 12.5C7.72386 12.5 7.5 12.2761 7.5 12V6C7.5 5.72386 7.72386 5.5 8 5.5Z"
      fill="currentColor"
    />
    <path
      d="M11 6C11 5.72386 10.7761 5.5 10.5 5.5C10.2239 5.5 10 5.72386 10 6V12C10 12.2761 10.2239 12.5 10.5 12.5C10.7761 12.5 11 12.2761 11 12V6Z"
      fill="currentColor"
    />
    <path
      d="M14.5 3C14.5 3.55228 14.0523 4 13.5 4H13V13C13 14.1046 12.1046 15 11 15H5C3.89543 15 3 14.1046 3 13V4H2.5C1.94772 4 1.5 3.55228 1.5 3V2C1.5 1.44772 1.94772 1 2.5 1H6C6 0.447715 6.44772 0 7 0H9C9.55229 0 10 0.447715 10 1H13.5C14.0523 1 14.5 1.44772 14.5 2V3ZM4.11803 4L4 4.05902V13C4 13.5523 4.44772 14 5 14H11C11.5523 14 12 13.5523 12 13V4.05902L11.882 4H4.11803ZM2.5 3H13.5V2H2.5V3Z"
      fill="currentColor"
    />
  </svg>
`;

export const plusCircleIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-plus-circle"
    viewBox="0 0 16 16"
  >
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    <path
      d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"
    />
  </svg>
`;

export const closeIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-x"
    viewBox="0 0 16 16"
  >
    <path
      d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"
    />
  </svg>
`;

export const threeDots = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-three-dots"
    viewBox="0 0 16 16"
  >
    <path
      d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"
    />
  </svg>
`;

export const threeDotsVertical = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-three-dots-vertical"
    viewBox="0 0 16 16"
  >
    <path
      d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"
    />
  </svg>
`;

export const warningCircle = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-exclamation-circle"
    viewBox="0 0 16 16"
  >
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    <path
      d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"
    />
  </svg>
`;

export const doorIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-door-open-fill"
    viewBox="0 0 16 16"
  >
    <path
      d="M1.5 15a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1H13V2.5A1.5 1.5 0 0 0 11.5 1H11V.5a.5.5 0 0 0-.57-.495l-7 1A.5.5 0 0 0 3 1.5V15zM11 2h.5a.5.5 0 0 1 .5.5V15h-1zm-2.5 8c-.276 0-.5-.448-.5-1s.224-1 .5-1 .5.448.5 1-.224 1-.5 1"
    />
  </svg>
`;

export const doorIconOutline = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height="${size}"
    fill="currentColor"
    class="bi bi-door-open"
    viewBox="0 0 16 16"
  >
    <path d="M8.5 10c-.276 0-.5-.448-.5-1s.224-1 .5-1 .5.448.5 1-.224 1-.5 1" />
    <path
      d="M10.828.122A.5.5 0 0 1 11 .5V1h.5A1.5 1.5 0 0 1 13 2.5V15h1.5a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1H3V1.5a.5.5 0 0 1 .43-.495l7-1a.5.5 0 0 1 .398.117M11.5 2H11v13h1V2.5a.5.5 0 0 0-.5-.5M4 1.934V15h6V1.077z"
    />
  </svg>
`;

export const personPlusIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-person-fill-add"
    viewBox="0 0 16 16"
  >
    <path
      d="M12.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m.5-5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1v-1a.5.5 0 0 1 1 0m-2-6a3 3 0 1 1-6 0 3 3 0 0 1 6 0"
    />
    <path
      d="M2 13c0 1 1 1 1 1h5.256A4.5 4.5 0 0 1 8 12.5a4.5 4.5 0 0 1 1.544-3.393Q8.844 9.002 8 9c-5 0-6 3-6 4"
    />
  </svg>
`;

export const magnifyingGlassIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path
      d="M11.7422 10.3439C12.5329 9.2673 13 7.9382 13 6.5C13 2.91015 10.0899 0 6.5 0C2.91015 0 0 2.91015 0 6.5C0 10.0899 2.91015 13 6.5 13C7.93858 13 9.26801 12.5327 10.3448 11.7415L10.3439 11.7422C10.3734 11.7822 10.4062 11.8204 10.4424 11.8566L14.2929 15.7071C14.6834 16.0976 15.3166 16.0976 15.7071 15.7071C16.0976 15.3166 16.0976 14.6834 15.7071 14.2929L11.8566 10.4424C11.8204 10.4062 11.7822 10.3734 11.7422 10.3439ZM12 6.5C12 9.53757 9.53757 12 6.5 12C3.46243 12 1 9.53757 1 6.5C1 3.46243 3.46243 1 6.5 1C9.53757 1 12 3.46243 12 6.5Z"
      fill="white"
    />
  </svg>
`;

export const chevronDoubleLeftIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-chevron-double-left"
    viewBox="0 0 16 16"
  >
    <path
      fill-rule="evenodd"
      d="M8.354 1.646a.5.5 0 0 1 0 .708L2.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"
    />
    <path
      fill-rule="evenodd"
      d="M12.354 1.646a.5.5 0 0 1 0 .708L6.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"
    />
  </svg>
`;

export const chevronDoubleRightIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-chevron-double-right"
    viewBox="0 0 16 16"
  >
    <path
      fill-rule="evenodd"
      d="M3.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L9.293 8 3.646 2.354a.5.5 0 0 1 0-.708"
    />
    <path
      fill-rule="evenodd"
      d="M7.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L13.293 8 7.646 2.354a.5.5 0 0 1 0-.708"
    />
  </svg>
`;

export const sendIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-send"
    viewBox="0 0 16 16"
  >
    <path
      d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576zm6.787-8.201L1.591 6.602l4.339 2.76z"
    />
  </svg>
`;

export const flaskIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size}
    height=${size}
    fill="currentColor"
    class="bi bi-flask"
    viewBox="0 0 16 16"
  >
    <path
      d="M4.5 0a.5.5 0 0 0 0 1H5v5.36L.503 13.717A1.5 1.5 0 0 0 1.783 16h12.434a1.5 1.5 0 0 0 1.28-2.282L11 6.359V1h.5a.5.5 0 0 0 0-1zM10 2H9a.5.5 0 0 0 0 1h1v1H9a.5.5 0 0 0 0 1h1v1H9a.5.5 0 0 0 0 1h1.22l.61 1H10a.5.5 0 1 0 0 1h1.442l.611 1H11a.5.5 0 1 0 0 1h1.664l.611 1H12a.5.5 0 1 0 0 1h1.886l.758 1.24a.5.5 0 0 1-.427.76H1.783a.5.5 0 0 1-.427-.76l4.57-7.48A.5.5 0 0 0 6 6.5V1h4z"
    />
  </svg>
`;

export const flaskIconRound = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="${size}"
    height="${size}"
    fill="currentColor"
    class="bi bi-flask-florence"
    viewBox="0 0 16 16"
  >
    <path
      d="M5.5 0a.5.5 0 0 0 0 1H6v5.416a5 5 0 1 0 4 0V1h.5a.5.5 0 0 0 0-1zM9 2h-.5a.5.5 0 0 0 0 1H9v1h-.5a.5.5 0 0 0 0 1H9v1h-.5a.5.5 0 0 0 0 1h.564a.5.5 0 0 0 .27.227A4.002 4.002 0 0 1 8 15a4 4 0 0 1-1.333-7.773.5.5 0 0 0 .333-.47V1h2z"
    />
  </svg>
`;

export const telescopeIcon = (size = 16) => html`
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
    <path
      d="M21.9,8.9L20.2,9.9L16.2,3L17.9,2L21.9,8.9M9.8,7.9L12.8,13.1L18.9,9.6L15.9,4.4L9.8,7.9M11.4,12.7L9.4,9.2L5.1,11.7L7.1,15.2L11.4,12.7M2.1,14.6L3.1,16.3L5.7,14.8L4.7,13.1L2.1,14.6M12.1,14L11.8,13.6L7.5,16.1L7.8,16.5C8,16.8 8.3,17.1 8.6,17.3L7,22H9L10.4,17.7H10.5L12,22H14L12.1,16.4C12.6,15.7 12.6,14.8 12.1,14Z"
    />
  </svg>
`;

export const hourGlassIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="${size}"
    height="${size}"
    fill="currentColor"
    class="bi bi-hourglass-split"
    viewBox="0 0 16 16"
  >
    <path
      d="M2.5 15a.5.5 0 1 1 0-1h1v-1a4.5 4.5 0 0 1 2.557-4.06c.29-.139.443-.377.443-.59v-.7c0-.213-.154-.451-.443-.59A4.5 4.5 0 0 1 3.5 3V2h-1a.5.5 0 0 1 0-1h11a.5.5 0 0 1 0 1h-1v1a4.5 4.5 0 0 1-2.557 4.06c-.29.139-.443.377-.443.59v.7c0 .213.154.451.443.59A4.5 4.5 0 0 1 12.5 13v1h1a.5.5 0 0 1 0 1zm2-13v1c0 .537.12 1.045.337 1.5h6.326c.216-.455.337-.963.337-1.5V2zm3 6.35c0 .701-.478 1.236-1.011 1.492A3.5 3.5 0 0 0 4.5 13s.866-1.299 3-1.48zm1 0v3.17c2.134.181 3 1.48 3 1.48a3.5 3.5 0 0 0-1.989-3.158C8.978 9.586 8.5 9.052 8.5 8.351z"
    />
  </svg>
`;

export const circleHalfIcon = (size = 16) => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="${size}"
    height="${size}"
    fill="currentColor"
    class="bi bi-circle-half"
    viewBox="0 0 16 16"
  >
    <path d="M8 15A7 7 0 1 0 8 1zm0 1A8 8 0 1 1 8 0a8 8 0 0 1 0 16" />
  </svg>
`;
